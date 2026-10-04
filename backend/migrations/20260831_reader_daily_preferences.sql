-- Per-day explicit discovery selections, kept strictly separate from the
-- long-term reader_profiles.preference_weights profile. A row here only says
-- "this reader already chose their context for this business day"; it never
-- feeds the learned preference model.
--
-- Business day is Asia/Shanghai, computed from server time. The application
-- writes the date explicitly (see app/services/daily_preference_service.py) so
-- unit tests can freeze it; the column default below is the equivalent
-- database-side expression and acts as a safety net for manual inserts.
begin;

create table if not exists public.reader_daily_preferences (
    user_id uuid not null references auth.users(id) on delete cascade,
    preference_date date not null
        default ((now() at time zone 'Asia/Shanghai')::date),
    setting_tags text[] not null default '{}',
    story_tone_tags text[] not null default '{}',
    relationship_core_tags text[] not null default '{}',
    completed_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, preference_date),
    -- One-dimensional arrays of bounded, non-null controlled terms. Free text
    -- never reaches this table: the API rejects anything outside the published
    -- vocabulary before writing.
    constraint reader_daily_preferences_setting_tags_check check (
        coalesce(array_ndims(setting_tags), 1) = 1
        and coalesce(cardinality(setting_tags), 0) <= 20
        and array_position(setting_tags, null) is null
    ),
    constraint reader_daily_preferences_story_tone_tags_check check (
        coalesce(array_ndims(story_tone_tags), 1) = 1
        and coalesce(cardinality(story_tone_tags), 0) <= 20
        and array_position(story_tone_tags, null) is null
    ),
    constraint reader_daily_preferences_relationship_core_tags_check check (
        coalesce(array_ndims(relationship_core_tags), 1) = 1
        and coalesce(cardinality(relationship_core_tags), 0) <= 20
        and array_position(relationship_core_tags, null) is null
    )
);

-- Supports retention/cleanup sweeps by day. Reads are always keyed by the
-- primary key (user_id, preference_date), which needs no extra index.
create index if not exists reader_daily_preferences_date_idx
    on public.reader_daily_preferences (preference_date);

-- Same posture as every other reader table: served only through FastAPI after
-- the Supabase access token is validated, so the browser cannot forge user_id.
alter table public.reader_daily_preferences enable row level security;

revoke all on public.reader_daily_preferences from anon, authenticated;
grant all on public.reader_daily_preferences to service_role;

comment on table public.reader_daily_preferences is
    'Explicit per-day discovery selections (Asia/Shanghai business date). Distinct from the long-term reader_profiles preference model; accessible through FastAPI only.';
comment on column public.reader_daily_preferences.preference_date is
    'Asia/Shanghai business date the selections belong to; written by the API, defaulted server-side.';
comment on column public.reader_daily_preferences.completed_at is
    'When the reader first completed the three-step flow for this business date.';
comment on column public.reader_daily_preferences.updated_at is
    'Last time the reader re-chose this business date''s preferences.';

commit;
