begin;

create table if not exists public.reader_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint reader_profiles_display_name_check
        check (char_length(btrim(display_name)) between 1 and 40)
);

create table if not exists public.reader_favorites (
    user_id uuid not null references auth.users(id) on delete cascade,
    book_id bigint not null references public.books(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, book_id)
);

create table if not exists public.reading_history (
    user_id uuid not null references auth.users(id) on delete cascade,
    book_id bigint not null references public.books(id) on delete cascade,
    progress_percent integer not null default 0,
    first_read_at timestamptz not null default now(),
    last_read_at timestamptz not null default now(),
    completed_at timestamptz,
    primary key (user_id, book_id),
    constraint reading_history_progress_check
        check (progress_percent between 0 and 100)
);

create index if not exists reader_favorites_recent_idx
    on public.reader_favorites (user_id, created_at desc);
create index if not exists reading_history_recent_idx
    on public.reading_history (user_id, last_read_at desc);

-- Reader business data is served only through FastAPI after validating the
-- Supabase access token. Browser-facing roles receive no direct table access.
alter table public.reader_profiles enable row level security;
alter table public.reader_favorites enable row level security;
alter table public.reading_history enable row level security;

revoke all on public.reader_profiles from anon, authenticated;
revoke all on public.reader_favorites from anon, authenticated;
revoke all on public.reading_history from anon, authenticated;

grant all on public.reader_profiles to service_role;
grant all on public.reader_favorites to service_role;
grant all on public.reading_history to service_role;

comment on table public.reader_profiles is
    'Minimal reader identity data; authentication credentials remain in Supabase Auth.';
comment on table public.reader_favorites is
    'Private per-reader saved-book relationships, accessible through FastAPI only.';
comment on table public.reading_history is
    'Private per-reader latest reading progress, accessible through FastAPI only.';

commit;
