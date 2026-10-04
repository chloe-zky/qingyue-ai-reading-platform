-- Release hardening: keep multi-row catalog creation atomic.

begin;

create or replace function public.create_internal_review_book(
    p_actor uuid,
    p_title text,
    p_author text,
    p_intro text,
    p_sample text,
    p_full_content text,
    p_author_access_token_hash text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_book_id bigint;
begin
    if p_actor is null or not exists (
        select 1
          from public.staff_profiles
         where user_id = p_actor
           and role = 'review_editor'
           and status = 'active'
    ) then
        raise exception 'active review editor required'
            using errcode = 'insufficient_privilege';
    end if;
    if nullif(btrim(p_title), '') is null
       or nullif(btrim(p_author), '') is null
       or nullif(btrim(p_intro), '') is null
       or nullif(btrim(p_sample), '') is null
       or p_author_access_token_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid internal book payload'
            using errcode = 'invalid_parameter_value';
    end if;

    insert into public.books (
        title, author, intro, sample, full_content, status,
        source_type, author_access_token_hash
    ) values (
        btrim(p_title), btrim(p_author), btrim(p_intro), btrim(p_sample),
        coalesce(p_full_content, ''), 'pending_review', 'internal',
        p_author_access_token_hash
    )
    returning id into v_book_id;

    insert into public.book_ai_tags (
        book_id, tag_source, tag_status,
        setting_tags, story_tone_tags, relationship_core_tags,
        aesthetic_tags, risk_tags
    ) values (
        v_book_id, 'manual', 'draft',
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );

    return v_book_id;
end;
$$;

revoke all on function public.create_internal_review_book(
    uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_internal_review_book(
    uuid, text, text, text, text, text, text
) to service_role;

create or replace function public.update_staff_account_atomic(
    p_actor uuid,
    p_target uuid,
    p_display_name text default null,
    p_role text default null,
    p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_before public.staff_profiles%rowtype;
    v_after public.staff_profiles%rowtype;
begin
    -- Serialize staff identity changes so two concurrent requests cannot both
    -- observe a second administrator and remove the final two accounts.
    lock table public.staff_profiles in share row exclusive mode;

    if p_actor is null or not exists (
        select 1
          from public.staff_profiles
         where user_id = p_actor
           and role = 'platform_admin'
           and status = 'active'
    ) then
        raise exception 'active platform admin required'
            using errcode = 'insufficient_privilege';
    end if;

    select * into v_before
      from public.staff_profiles
     where user_id = p_target;
    if not found then
        raise exception 'staff account not found'
            using errcode = 'no_data_found';
    end if;

    if p_role is not null
       and p_role not in ('platform_admin', 'editorial_lead', 'review_editor') then
        raise exception 'invalid staff role' using errcode = 'invalid_parameter_value';
    end if;
    if p_status is not null and p_status not in ('active', 'disabled') then
        raise exception 'invalid staff status' using errcode = 'invalid_parameter_value';
    end if;
    if p_display_name is not null and nullif(btrim(p_display_name), '') is null then
        raise exception 'invalid display name' using errcode = 'invalid_parameter_value';
    end if;
    if p_actor = p_target and (p_role is not null or p_status is not null) then
        raise exception 'cannot update own role or status'
            using errcode = 'integrity_constraint_violation';
    end if;

    if v_before.role = 'platform_admin'
       and v_before.status = 'active'
       and (
           coalesce(p_role, v_before.role) <> 'platform_admin'
           or coalesce(p_status, v_before.status) <> 'active'
       )
       and (
           select count(*)
             from public.staff_profiles
            where role = 'platform_admin' and status = 'active'
       ) <= 1 then
        raise exception 'last active platform admin'
            using errcode = 'integrity_constraint_violation';
    end if;

    update public.staff_profiles
       set display_name = coalesce(btrim(p_display_name), display_name),
           role = coalesce(p_role, role),
           status = coalesce(p_status, status)
     where user_id = p_target
     returning * into v_after;

    return jsonb_build_object(
        'before', to_jsonb(v_before),
        'after', to_jsonb(v_after)
    );
end;
$$;

revoke all on function public.update_staff_account_atomic(
    uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_staff_account_atomic(
    uuid, uuid, text, text, text
) to service_role;

create or replace function public.update_llm_config_atomic(
    p_api_base text,
    p_model_name text,
    p_api_type text,
    p_timeout_seconds integer default null,
    p_max_retries integer default null,
    p_ciphertext text default null,
    p_key_id text default null,
    p_algorithm text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
    if nullif(btrim(p_api_base), '') is null
       or nullif(btrim(p_model_name), '') is null
       or p_api_type <> 'openai_compatible'
       or (p_timeout_seconds is not null and p_timeout_seconds not between 1 and 300)
       or (p_max_retries is not null and p_max_retries not between 0 and 10) then
        raise exception 'invalid llm configuration'
            using errcode = 'invalid_parameter_value';
    end if;
    if (p_ciphertext is null) <> (p_key_id is null)
       or (p_ciphertext is null) <> (p_algorithm is null) then
        raise exception 'incomplete encrypted secret'
            using errcode = 'invalid_parameter_value';
    end if;

    insert into public.system_configs (config_key, config_value, config_desc)
    values
        ('llm_api_base', btrim(p_api_base), 'OpenAI compatible API Base URL'),
        ('llm_model_name', btrim(p_model_name), '当前使用的模型名称'),
        ('llm_api_type', p_api_type, 'API 类型')
    on conflict (config_key) do update set
        config_value = excluded.config_value,
        config_desc = excluded.config_desc;

    if p_timeout_seconds is not null then
        insert into public.system_configs (config_key, config_value, config_desc)
        values ('llm_timeout_seconds', p_timeout_seconds::text, 'AI 请求超时秒数')
        on conflict (config_key) do update set
            config_value = excluded.config_value,
            config_desc = excluded.config_desc;
    end if;
    if p_max_retries is not null then
        insert into public.system_configs (config_key, config_value, config_desc)
        values ('llm_max_retries', p_max_retries::text, 'AI 请求最大重试次数')
        on conflict (config_key) do update set
            config_value = excluded.config_value,
            config_desc = excluded.config_desc;
    end if;

    if p_ciphertext is not null then
        insert into public.system_config_secrets (
            config_key, ciphertext, key_id, algorithm, updated_at
        ) values (
            'llm_api_key', p_ciphertext, p_key_id, p_algorithm, now()
        )
        on conflict (config_key) do update set
            ciphertext = excluded.ciphertext,
            key_id = excluded.key_id,
            algorithm = excluded.algorithm,
            updated_at = excluded.updated_at;
        delete from public.system_configs where config_key = 'llm_api_key';
    end if;
end;
$$;

revoke all on function public.update_llm_config_atomic(
    text, text, text, integer, integer, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_llm_config_atomic(
    text, text, text, integer, integer, text, text, text
) to service_role;

commit;
