begin;

-- Keep the first personalization release deliberately small: existing reader
-- rows hold one rebuildable preference snapshot, while reading rows hold only
-- aggregate engagement counters. No raw scroll/mouse stream is stored.
alter table public.reader_profiles
    add column if not exists personalization_enabled boolean not null default true,
    add column if not exists preference_weights jsonb not null default
        '{"setting":{},"story_tone":{},"relationship_core":{}}'::jsonb,
    add column if not exists preference_updated_at timestamptz not null default now();

alter table public.reader_profiles
    drop constraint if exists reader_profiles_preference_weights_object_check;
alter table public.reader_profiles
    add constraint reader_profiles_preference_weights_object_check
    check (jsonb_typeof(preference_weights) = 'object');

alter table public.reading_history
    add column if not exists active_seconds integer not null default 0,
    add column if not exists open_count integer not null default 0,
    add column if not exists completion_count integer not null default 0,
    add column if not exists preference_signal_score smallint not null default 0,
    add column if not exists last_request_id text;

alter table public.reading_history
    drop constraint if exists reading_history_active_seconds_check,
    drop constraint if exists reading_history_open_count_check,
    drop constraint if exists reading_history_completion_count_check,
    drop constraint if exists reading_history_preference_signal_score_check,
    drop constraint if exists reading_history_last_request_id_check;
alter table public.reading_history
    add constraint reading_history_active_seconds_check check (active_seconds >= 0),
    add constraint reading_history_open_count_check check (open_count >= 0),
    add constraint reading_history_completion_count_check check (completion_count >= 0),
    add constraint reading_history_preference_signal_score_check
        check (preference_signal_score between 0 and 3),
    add constraint reading_history_last_request_id_check
        check (last_request_id is null or char_length(last_request_id) <= 64);

alter table public.recommendation_logs
    add column if not exists reader_user_id uuid references auth.users(id) on delete set null;

alter table public.feedbacks
    add column if not exists reader_user_id uuid references auth.users(id) on delete set null;

create index if not exists recommendation_logs_reader_recent_idx
    on public.recommendation_logs (reader_user_id, created_at desc)
    where reader_user_id is not null;
create index if not exists feedbacks_reader_book_idx
    on public.feedbacks (reader_user_id, book_id)
    where reader_user_id is not null;

comment on column public.reader_profiles.preference_weights is
    'Rebuildable, explainable controlled-tag affinity snapshot; no raw reading text.';
comment on column public.reading_history.active_seconds is
    'Aggregated foreground reading seconds; no raw pointer or scroll events.';
comment on column public.reading_history.last_request_id is
    'Optional recommendation request attribution for aggregate evaluation.';

commit;
