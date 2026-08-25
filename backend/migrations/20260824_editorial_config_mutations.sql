-- Atomic publication/rollback helpers for editorial configuration.
-- Browser clients never receive EXECUTE. FastAPI invokes these functions with
-- the service-role client after its own editorial_lead RBAC check.

begin;

create or replace function public.assert_active_editorial_lead(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not exists (
        select 1
        from public.staff_profiles
        where user_id = p_actor
          and role = 'editorial_lead'
          and status = 'active'
    ) then
        raise exception 'active editorial_lead required';
    end if;
end;
$$;

create or replace function public.publish_editorial_prompt_version(
    p_prompt_id uuid,
    p_version_no integer,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    target public.editorial_prompt_versions%rowtype;
begin
    perform public.assert_active_editorial_lead(p_actor);

    select * into target
    from public.editorial_prompt_versions
    where prompt_id = p_prompt_id
      and version_no = p_version_no
    for update;

    if not found then
        raise exception 'prompt version not found';
    end if;
    if target.status <> 'draft' then
        raise exception 'prompt version is not a draft';
    end if;

    update public.editorial_prompt_versions
    set status = 'archived'
    where prompt_id = p_prompt_id
      and status = 'published';

    update public.editorial_prompt_versions
    set status = 'published',
        published_by = p_actor,
        published_at = now()
    where id = target.id;

    return jsonb_build_object('version_no', p_version_no, 'status', 'published');
end;
$$;

create or replace function public.rollback_editorial_prompt_version(
    p_prompt_id uuid,
    p_target_version_no integer,
    p_change_note text,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    source public.editorial_prompt_versions%rowtype;
    next_version integer;
begin
    perform public.assert_active_editorial_lead(p_actor);

    perform 1
    from public.editorial_prompt_versions
    where prompt_id = p_prompt_id
    for update;

    select * into source
    from public.editorial_prompt_versions
    where prompt_id = p_prompt_id
      and version_no = p_target_version_no;
    if not found then
        raise exception 'prompt rollback target not found';
    end if;

    select coalesce(max(version_no), 0) + 1 into next_version
    from public.editorial_prompt_versions
    where prompt_id = p_prompt_id;

    update public.editorial_prompt_versions
    set status = 'archived'
    where prompt_id = p_prompt_id
      and status = 'published';

    insert into public.editorial_prompt_versions (
        prompt_id, version_no, status, system_prompt, user_prompt_template,
        variables, change_note, created_by, published_by, published_at
    ) values (
        p_prompt_id, next_version, 'published', source.system_prompt,
        source.user_prompt_template, source.variables,
        coalesce(nullif(btrim(p_change_note), ''),
            format('回滚至 v%s 的内容', p_target_version_no)),
        p_actor, p_actor, now()
    );

    return jsonb_build_object('version_no', next_version, 'status', 'published');
end;
$$;

create or replace function public.publish_editorial_strategy_version(
    p_strategy_id uuid,
    p_version_no integer,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    target public.editorial_strategy_versions%rowtype;
    weight_total numeric;
begin
    perform public.assert_active_editorial_lead(p_actor);

    select * into target
    from public.editorial_strategy_versions
    where strategy_id = p_strategy_id
      and version_no = p_version_no
    for update;
    if not found then
        raise exception 'strategy version not found';
    end if;
    if target.status <> 'draft' then
        raise exception 'strategy version is not a draft';
    end if;

    weight_total :=
        coalesce((target.settings #>> '{weights,setting}')::numeric, 0)
        + coalesce((target.settings #>> '{weights,story_tone}')::numeric, 0)
        + coalesce((target.settings #>> '{weights,relationship_core}')::numeric, 0);
    if weight_total <> 100 then
        raise exception 'strategy weights must total 100';
    end if;

    update public.editorial_strategy_versions
    set status = 'archived'
    where strategy_id = p_strategy_id
      and status = 'published';

    update public.editorial_strategy_versions
    set status = 'published',
        published_by = p_actor,
        published_at = now()
    where id = target.id;

    return jsonb_build_object('version_no', p_version_no, 'status', 'published');
end;
$$;

create or replace function public.rollback_editorial_strategy_version(
    p_strategy_id uuid,
    p_target_version_no integer,
    p_change_note text,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    source public.editorial_strategy_versions%rowtype;
    next_version integer;
begin
    perform public.assert_active_editorial_lead(p_actor);

    perform 1
    from public.editorial_strategy_versions
    where strategy_id = p_strategy_id
    for update;

    select * into source
    from public.editorial_strategy_versions
    where strategy_id = p_strategy_id
      and version_no = p_target_version_no;
    if not found then
        raise exception 'strategy rollback target not found';
    end if;

    select coalesce(max(version_no), 0) + 1 into next_version
    from public.editorial_strategy_versions
    where strategy_id = p_strategy_id;

    update public.editorial_strategy_versions
    set status = 'archived'
    where strategy_id = p_strategy_id
      and status = 'published';

    insert into public.editorial_strategy_versions (
        strategy_id, version_no, status, settings, change_note,
        created_by, published_by, published_at
    ) values (
        p_strategy_id, next_version, 'published', source.settings,
        coalesce(nullif(btrim(p_change_note), ''),
            format('回滚至 v%s 的内容', p_target_version_no)),
        p_actor, p_actor, now()
    );

    return jsonb_build_object('version_no', next_version, 'status', 'published');
end;
$$;

create or replace function public.clone_published_tag_vocabulary(
    p_change_note text,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    source_version public.tag_vocabulary_versions%rowtype;
    new_version_id uuid;
    next_version integer;
    source_category record;
    new_category_id uuid;
begin
    perform public.assert_active_editorial_lead(p_actor);

    if exists (
        select 1 from public.tag_vocabulary_versions where status = 'draft'
    ) then
        raise exception 'a vocabulary draft already exists';
    end if;

    select * into source_version
    from public.tag_vocabulary_versions
    where status = 'published'
    for update;
    if not found then
        raise exception 'published vocabulary not found';
    end if;

    select coalesce(max(version_no), 0) + 1 into next_version
    from public.tag_vocabulary_versions;

    insert into public.tag_vocabulary_versions (
        version_no, status, change_note, created_by
    ) values (
        next_version, 'draft', coalesce(p_change_note, ''), p_actor
    ) returning id into new_version_id;

    for source_category in
        select * from public.tag_categories
        where vocabulary_version_id = source_version.id
        order by sort_order, name
    loop
        insert into public.tag_categories (
            vocabulary_version_id, category_key, name, description,
            sort_order, status
        ) values (
            new_version_id, source_category.category_key, source_category.name,
            source_category.description, source_category.sort_order,
            source_category.status
        ) returning id into new_category_id;

        insert into public.tag_terms (
            category_id, term_key, name, description, synonyms, sort_order, status
        )
        select
            new_category_id, term_key, name, description, synonyms,
            sort_order, status
        from public.tag_terms
        where category_id = source_category.id;
    end loop;

    return jsonb_build_object('version_no', next_version, 'status', 'draft');
end;
$$;

create or replace function public.publish_tag_vocabulary_version(
    p_version_id uuid,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    target public.tag_vocabulary_versions%rowtype;
    required_category_count integer;
begin
    perform public.assert_active_editorial_lead(p_actor);

    select * into target
    from public.tag_vocabulary_versions
    where id = p_version_id
    for update;
    if not found then
        raise exception 'vocabulary version not found';
    end if;
    if target.status <> 'draft' then
        raise exception 'vocabulary version is not a draft';
    end if;

    select count(distinct category_key) into required_category_count
    from public.tag_categories
    where vocabulary_version_id = p_version_id
      and status = 'active'
      and category_key in (
          'setting', 'story_tone', 'relationship_core', 'aesthetic', 'risk'
      );
    if required_category_count <> 5 then
        raise exception 'vocabulary must contain five active required categories';
    end if;
    if exists (
        select 1
        from public.tag_categories category
        where category.vocabulary_version_id = p_version_id
          and category.status = 'active'
          and not exists (
              select 1 from public.tag_terms term
              where term.category_id = category.id and term.status = 'active'
          )
    ) then
        raise exception 'every active vocabulary category needs an active term';
    end if;

    update public.tag_vocabulary_versions
    set status = 'archived'
    where status = 'published';

    update public.tag_vocabulary_versions
    set status = 'published', published_by = p_actor, published_at = now()
    where id = p_version_id;

    return jsonb_build_object(
        'version_no', target.version_no, 'status', 'published'
    );
end;
$$;

create or replace function public.rollback_tag_vocabulary_version(
    p_target_version_no integer,
    p_change_note text,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    source_version public.tag_vocabulary_versions%rowtype;
    new_version_id uuid;
    next_version integer;
    source_category record;
    new_category_id uuid;
begin
    perform public.assert_active_editorial_lead(p_actor);

    perform 1 from public.tag_vocabulary_versions for update;
    select * into source_version
    from public.tag_vocabulary_versions
    where version_no = p_target_version_no;
    if not found then
        raise exception 'vocabulary rollback target not found';
    end if;

    select coalesce(max(version_no), 0) + 1 into next_version
    from public.tag_vocabulary_versions;

    update public.tag_vocabulary_versions
    set status = 'archived'
    where status = 'published';

    insert into public.tag_vocabulary_versions (
        version_no, status, change_note, created_by, published_by, published_at
    ) values (
        next_version, 'published',
        coalesce(nullif(btrim(p_change_note), ''),
            format('回滚至 v%s 的内容', p_target_version_no)),
        p_actor, p_actor, now()
    ) returning id into new_version_id;

    for source_category in
        select * from public.tag_categories
        where vocabulary_version_id = source_version.id
        order by sort_order, name
    loop
        insert into public.tag_categories (
            vocabulary_version_id, category_key, name, description,
            sort_order, status
        ) values (
            new_version_id, source_category.category_key, source_category.name,
            source_category.description, source_category.sort_order,
            source_category.status
        ) returning id into new_category_id;

        insert into public.tag_terms (
            category_id, term_key, name, description, synonyms, sort_order, status
        )
        select
            new_category_id, term_key, name, description, synonyms,
            sort_order, status
        from public.tag_terms
        where category_id = source_category.id;
    end loop;

    return jsonb_build_object('version_no', next_version, 'status', 'published');
end;
$$;

revoke all on function public.assert_active_editorial_lead(uuid)
    from public, anon, authenticated;
revoke all on function public.publish_editorial_prompt_version(uuid, integer, uuid)
    from public, anon, authenticated;
revoke all on function public.rollback_editorial_prompt_version(uuid, integer, text, uuid)
    from public, anon, authenticated;
revoke all on function public.publish_editorial_strategy_version(uuid, integer, uuid)
    from public, anon, authenticated;
revoke all on function public.rollback_editorial_strategy_version(uuid, integer, text, uuid)
    from public, anon, authenticated;
revoke all on function public.clone_published_tag_vocabulary(text, uuid)
    from public, anon, authenticated;
revoke all on function public.publish_tag_vocabulary_version(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.rollback_tag_vocabulary_version(integer, text, uuid)
    from public, anon, authenticated;

grant execute on function public.assert_active_editorial_lead(uuid) to service_role;
grant execute on function public.publish_editorial_prompt_version(uuid, integer, uuid)
    to service_role;
grant execute on function public.rollback_editorial_prompt_version(uuid, integer, text, uuid)
    to service_role;
grant execute on function public.publish_editorial_strategy_version(uuid, integer, uuid)
    to service_role;
grant execute on function public.rollback_editorial_strategy_version(uuid, integer, text, uuid)
    to service_role;
grant execute on function public.clone_published_tag_vocabulary(text, uuid)
    to service_role;
grant execute on function public.publish_tag_vocabulary_version(uuid, uuid)
    to service_role;
grant execute on function public.rollback_tag_vocabulary_version(integer, text, uuid)
    to service_role;

commit;
