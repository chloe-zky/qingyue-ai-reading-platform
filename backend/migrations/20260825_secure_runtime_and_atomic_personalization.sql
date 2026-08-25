begin;

-- Encrypted runtime secrets. The wrapping key remains in the backend runtime;
-- Supabase stores only authenticated ciphertext and key metadata.
create table if not exists public.system_config_secrets (
    config_key text primary key,
    ciphertext text not null,
    key_id text not null,
    algorithm text not null,
    updated_at timestamptz not null default now(),
    constraint system_config_secrets_key_check
        check (config_key = 'llm_api_key'),
    constraint system_config_secrets_ciphertext_check
        check (char_length(ciphertext) between 40 and 20000),
    constraint system_config_secrets_key_id_check
        check (key_id ~ '^[A-Za-z0-9_-]{1,40}$'),
    constraint system_config_secrets_algorithm_check
        check (algorithm = 'AES-256-GCM')
);

alter table public.system_config_secrets enable row level security;
revoke all on public.system_config_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.system_config_secrets to service_role;

create or replace function public.store_encrypted_system_secret(
    p_config_key text,
    p_ciphertext text,
    p_key_id text,
    p_algorithm text
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
    if p_config_key <> 'llm_api_key' then
        raise exception 'unsupported secret key' using errcode = '22023';
    end if;
    insert into public.system_config_secrets (
        config_key, ciphertext, key_id, algorithm, updated_at
    ) values (
        p_config_key, p_ciphertext, p_key_id, p_algorithm, now()
    )
    on conflict (config_key) do update set
        ciphertext = excluded.ciphertext,
        key_id = excluded.key_id,
        algorithm = excluded.algorithm,
        updated_at = excluded.updated_at;

    -- Remove the old plaintext only after the ciphertext row passes all table
    -- constraints and has been stored in the same transaction.
    delete from public.system_configs where config_key = p_config_key;
end;
$$;

revoke all on function public.store_encrypted_system_secret(text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.store_encrypted_system_secret(text, text, text, text)
    to service_role;

-- Internal helper: decay the existing explainable snapshot, then apply only
-- confirmed controlled tags belonging to the selected published book.
create or replace function public._apply_book_preference_signal(
    p_user_id uuid,
    p_book_id bigint,
    p_delta double precision,
    p_dimensions text[] default array['setting','story_tone','relationship_core']::text[]
) returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_enabled boolean;
    v_weights jsonb;
    v_updated_at timestamptz;
    v_result jsonb := '{"setting":{},"story_tone":{},"relationship_core":{}}'::jsonb;
    v_factor double precision;
    v_dimension text;
    v_entry record;
    v_score double precision;
    v_tags jsonb;
    v_tag text;
begin
    p_dimensions := coalesce(
        p_dimensions,
        array['setting','story_tone','relationship_core']::text[]
    );
    if p_delta = 0 or p_delta < -20 or p_delta > 20 then
        return;
    end if;
    if p_dimensions <@ array['setting','story_tone','relationship_core']::text[] is not true then
        raise exception 'invalid preference dimension' using errcode = '22023';
    end if;

    select personalization_enabled, preference_weights, preference_updated_at
      into v_enabled, v_weights, v_updated_at
      from public.reader_profiles
     where user_id = p_user_id
     for update;
    if not found or not v_enabled then
        return;
    end if;

    v_factor := power(
        0.5::double precision,
        greatest(0, extract(epoch from (now() - v_updated_at))) / 2592000.0
    );
    v_weights := coalesce(v_weights, '{}'::jsonb);

    foreach v_dimension in array array['setting','story_tone','relationship_core']::text[] loop
        for v_entry in
            select key, value
              from jsonb_each(coalesce(v_weights -> v_dimension, '{}'::jsonb))
        loop
            begin
                v_score := greatest(-20, least(20, (v_entry.value #>> '{}')::double precision * v_factor));
            exception when others then
                continue;
            end;
            if char_length(v_entry.key) between 1 and 40 and abs(v_score) >= 0.05 then
                v_result := jsonb_set(
                    v_result,
                    array[v_dimension, v_entry.key],
                    to_jsonb(round(v_score::numeric, 4)),
                    true
                );
            end if;
        end loop;
    end loop;

    select case v_dimension
        when 'setting' then to_jsonb(t.setting_tags)
        when 'story_tone' then to_jsonb(t.story_tone_tags)
        when 'relationship_core' then to_jsonb(t.relationship_core_tags)
        else '[]'::jsonb
    end
      into v_tags
      from public.book_ai_tags t
     where t.book_id = p_book_id and t.tag_status = 'confirmed'
     limit 1;

    if found then
        foreach v_dimension in array p_dimensions loop
            select case v_dimension
                when 'setting' then to_jsonb(t.setting_tags)
                when 'story_tone' then to_jsonb(t.story_tone_tags)
                when 'relationship_core' then to_jsonb(t.relationship_core_tags)
            end
              into v_tags
              from public.book_ai_tags t
             where t.book_id = p_book_id and t.tag_status = 'confirmed'
             limit 1;
            for v_tag in
                select value from jsonb_array_elements_text(coalesce(v_tags, '[]'::jsonb))
            loop
                v_tag := btrim(v_tag);
                if char_length(v_tag) between 1 and 40 then
                    v_score := coalesce((v_result -> v_dimension ->> v_tag)::double precision, 0) + p_delta;
                    v_score := greatest(-20, least(20, v_score));
                    if abs(v_score) < 0.05 then
                        v_result := jsonb_set(
                            v_result,
                            array[v_dimension],
                            (v_result -> v_dimension) - v_tag,
                            true
                        );
                    else
                        v_result := jsonb_set(
                            v_result,
                            array[v_dimension, v_tag],
                            to_jsonb(round(v_score::numeric, 4)),
                            true
                        );
                    end if;
                end if;
            end loop;
        end loop;
    end if;

    -- Retain at most the 50 strongest tags in each dimension.
    foreach v_dimension in array array['setting','story_tone','relationship_core']::text[] loop
        select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
          into v_weights
          from (
              select key, value
                from jsonb_each(v_result -> v_dimension)
               order by abs((value #>> '{}')::double precision) desc, key
               limit 50
          ) ranked;
        v_result := jsonb_set(v_result, array[v_dimension], v_weights, true);
    end loop;

    update public.reader_profiles
       set preference_weights = v_result,
           preference_updated_at = now(),
           updated_at = now()
     where user_id = p_user_id;
end;
$$;

revoke all on function public._apply_book_preference_signal(uuid, bigint, double precision, text[])
    from public, anon, authenticated;
grant execute on function public._apply_book_preference_signal(uuid, bigint, double precision, text[])
    to service_role;

create or replace function public.set_reader_favorite_atomic(
    p_user_id uuid,
    p_book_id bigint,
    p_is_favorite boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_changed integer := 0;
begin
    if not exists (
        select 1 from public.books where id = p_book_id and status = 'active'
    ) then
        raise exception 'book_not_found' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':favorite:' || p_book_id::text, 0));
    if p_is_favorite then
        insert into public.reader_favorites (user_id, book_id)
        values (p_user_id, p_book_id)
        on conflict (user_id, book_id) do nothing;
        get diagnostics v_changed = row_count;
        if v_changed = 1 then
            perform public._apply_book_preference_signal(p_user_id, p_book_id, 3, null);
        end if;
    else
        delete from public.reader_favorites
         where user_id = p_user_id and book_id = p_book_id;
        get diagnostics v_changed = row_count;
        if v_changed = 1 then
            perform public._apply_book_preference_signal(p_user_id, p_book_id, -3, null);
        end if;
    end if;
    return jsonb_build_object('book_id', p_book_id, 'is_favorite', p_is_favorite, 'changed', v_changed = 1);
end;
$$;

revoke all on function public.set_reader_favorite_atomic(uuid, bigint, boolean)
    from public, anon, authenticated;
grant execute on function public.set_reader_favorite_atomic(uuid, bigint, boolean)
    to service_role;

create or replace function public.record_reader_progress_atomic(
    p_user_id uuid,
    p_book_id bigint,
    p_progress_percent integer,
    p_active_seconds_delta integer default 0,
    p_opened boolean default false,
    p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_row public.reading_history%rowtype;
    v_now timestamptz := now();
    v_next_progress integer;
    v_target_signal smallint;
    v_previous_signal smallint := 0;
begin
    if p_progress_percent not between 0 and 100
       or p_active_seconds_delta not between 0 and 86400
       or (p_request_id is not null and char_length(p_request_id) > 64) then
        raise exception 'invalid reading progress' using errcode = '22023';
    end if;
    if not exists (
        select 1 from public.books where id = p_book_id and status = 'active'
    ) then
        raise exception 'book_not_found' using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':progress:' || p_book_id::text, 0));
    select * into v_row
      from public.reading_history
     where user_id = p_user_id and book_id = p_book_id
     for update;

    if found then
        v_previous_signal := v_row.preference_signal_score;
        v_next_progress := greatest(v_row.progress_percent, p_progress_percent);
        v_row.active_seconds := v_row.active_seconds + p_active_seconds_delta;
        if p_opened and v_now - v_row.last_read_at >= interval '5 minutes' then
            v_row.open_count := v_row.open_count + 1;
        end if;
        if v_row.completed_at is null and v_next_progress >= 85 then
            v_row.completed_at := v_now;
            v_row.completion_count := v_row.completion_count + 1;
        end if;
        v_target_signal := case
            when v_row.completed_at is not null then 3
            when v_row.active_seconds >= 30 and v_next_progress >= 10 then 1
            else 0
        end;
        update public.reading_history set
            progress_percent = v_next_progress,
            last_read_at = v_now,
            completed_at = v_row.completed_at,
            active_seconds = v_row.active_seconds,
            open_count = v_row.open_count,
            completion_count = v_row.completion_count,
            preference_signal_score = v_target_signal,
            last_request_id = coalesce(p_request_id, last_request_id)
        where user_id = p_user_id and book_id = p_book_id
        returning * into v_row;
    else
        v_next_progress := p_progress_percent;
        v_target_signal := case
            when v_next_progress >= 85 then 3
            when p_active_seconds_delta >= 30 and v_next_progress >= 10 then 1
            else 0
        end;
        insert into public.reading_history (
            user_id, book_id, progress_percent, first_read_at, last_read_at,
            completed_at, active_seconds, open_count, completion_count,
            preference_signal_score, last_request_id
        ) values (
            p_user_id, p_book_id, v_next_progress, v_now, v_now,
            case when v_next_progress >= 85 then v_now end,
            p_active_seconds_delta, case when p_opened then 1 else 0 end,
            case when v_next_progress >= 85 then 1 else 0 end,
            v_target_signal, p_request_id
        ) returning * into v_row;
    end if;

    if v_target_signal > v_previous_signal then
        perform public._apply_book_preference_signal(
            p_user_id, p_book_id, v_target_signal - v_previous_signal, null
        );
    end if;
    return to_jsonb(v_row);
end;
$$;

revoke all on function public.record_reader_progress_atomic(uuid, bigint, integer, integer, boolean, text)
    from public, anon, authenticated;
grant execute on function public.record_reader_progress_atomic(uuid, bigint, integer, integer, boolean, text)
    to service_role;

create unique index if not exists feedbacks_reader_request_book_uidx
    on public.feedbacks (reader_user_id, request_id, book_id)
    where reader_user_id is not null;

create or replace function public.record_reader_feedback_atomic(
    p_user_id uuid,
    p_request_id text,
    p_book_id bigint,
    p_book_title text,
    p_reason text,
    p_user_prefs jsonb,
    p_feedback_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_row public.feedbacks%rowtype;
    v_delta double precision;
    v_dimensions text[];
begin
    if char_length(btrim(p_request_id)) not between 1 and 64
       or char_length(btrim(p_book_title)) not between 1 and 120
       or char_length(coalesce(p_feedback_note, '')) > 1000
       or p_reason not in ('推荐准确','不感兴趣','标签不准','风格不符') then
        raise exception 'invalid feedback' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(
        hashtextextended(p_user_id::text || ':feedback:' || p_request_id || ':' || p_book_id::text, 0)
    );
    select * into v_row
      from public.feedbacks
     where reader_user_id = p_user_id
       and request_id = p_request_id
       and book_id = p_book_id
     limit 1;
    if found then
        return to_jsonb(v_row);
    end if;

    insert into public.feedbacks (
        request_id, book_id, book_title, reason, user_prefs,
        feedback_note, reader_user_id
    ) values (
        btrim(p_request_id), p_book_id, btrim(p_book_title), p_reason,
        coalesce(p_user_prefs, '{}'::jsonb), coalesce(p_feedback_note, ''), p_user_id
    ) returning * into v_row;

    if p_reason = '推荐准确' then
        v_delta := 3; v_dimensions := null;
    elsif p_reason = '不感兴趣' then
        v_delta := -4; v_dimensions := null;
    elsif p_reason = '风格不符' then
        v_delta := -3; v_dimensions := array['story_tone']::text[];
    end if;
    if v_delta is not null then
        perform public._apply_book_preference_signal(p_user_id, p_book_id, v_delta, v_dimensions);
    end if;
    return to_jsonb(v_row);
end;
$$;

revoke all on function public.record_reader_feedback_atomic(uuid, text, bigint, text, text, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.record_reader_feedback_atomic(uuid, text, bigint, text, text, jsonb, text)
    to service_role;

create or replace function public.get_book_quality_scores(p_book_ids bigint[])
returns table(book_id bigint, quality_score double precision)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with candidates as (
        select distinct id as book_id
          from unnest(coalesce(p_book_ids, array[]::bigint[])) id
         limit 500
    ), history as (
        select h.book_id,
               sum(
                   2 * h.completion_count
                   + least(h.active_seconds / 300.0, 1)
                   + least(h.open_count, 3) * 0.2
               ) as score
          from public.reading_history h
          join candidates c on c.book_id = h.book_id
         group by h.book_id
    ), favorites as (
        select f.book_id, count(*) * 3.0 as score
          from public.reader_favorites f
          join candidates c on c.book_id = f.book_id
         group by f.book_id
    ), raw as (
        select c.book_id,
               coalesce(h.score, 0) + coalesce(f.score, 0) as score
          from candidates c
          left join history h using (book_id)
          left join favorites f using (book_id)
    ), normalized as (
        select raw.*, max(score) over () as maximum from raw
    )
    select book_id,
           case when maximum > 0 then score / maximum else 0 end::double precision
      from normalized;
$$;

revoke all on function public.get_book_quality_scores(bigint[])
    from public, anon, authenticated;
grant execute on function public.get_book_quality_scores(bigint[]) to service_role;

create index if not exists books_active_recommendation_idx
    on public.books (created_at desc, id desc)
    where status = 'active';
create index if not exists book_ai_tags_confirmed_book_idx
    on public.book_ai_tags (book_id)
    where tag_status = 'confirmed';

comment on table public.system_config_secrets is
    'Backend-only encrypted runtime secrets; wrapping keys never enter Supabase.';
comment on function public.record_reader_progress_atomic is
    'Atomically aggregates privacy-minimal reading engagement and controlled-tag preference signals.';

commit;
