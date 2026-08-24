begin;

create extension if not exists pgcrypto;

create table if not exists public.staff_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null default '',
    role text not null check (
        role in ('platform_admin', 'editorial_lead', 'review_editor')
    ),
    status text not null default 'active' check (
        status in ('active', 'disabled')
    ),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_login_at timestamptz
);

create index if not exists staff_profiles_role_status_idx
    on public.staff_profiles (role, status);

comment on table public.staff_profiles is
    'Internal staff identities. One account has exactly one active role.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists staff_profiles_set_updated_at on public.staff_profiles;
create trigger staff_profiles_set_updated_at
before update on public.staff_profiles
for each row execute function public.set_updated_at();

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select role
    from public.staff_profiles
    where user_id = auth.uid()
      and status = 'active'
    limit 1;
$$;

revoke all on function public.current_staff_role() from public;
grant execute on function public.current_staff_role() to authenticated;

create table if not exists public.editorial_prompts (
    id uuid primary key default gen_random_uuid(),
    prompt_key text not null unique,
    name text not null,
    use_case text not null,
    description text not null default '',
    status text not null default 'active' check (
        status in ('active', 'disabled')
    ),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists editorial_prompts_set_updated_at on public.editorial_prompts;
create trigger editorial_prompts_set_updated_at
before update on public.editorial_prompts
for each row execute function public.set_updated_at();

create table if not exists public.editorial_prompt_versions (
    id uuid primary key default gen_random_uuid(),
    prompt_id uuid not null references public.editorial_prompts(id) on delete cascade,
    version_no integer not null check (version_no > 0),
    status text not null default 'draft' check (
        status in ('draft', 'published', 'archived')
    ),
    system_prompt text not null default '',
    user_prompt_template text not null default '',
    variables jsonb not null default '[]'::jsonb,
    change_note text not null default '',
    created_by uuid references auth.users(id) on delete set null,
    published_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    published_at timestamptz,
    unique (prompt_id, version_no)
);

create unique index if not exists editorial_prompt_one_published_idx
    on public.editorial_prompt_versions (prompt_id)
    where status = 'published';

create index if not exists editorial_prompt_versions_lookup_idx
    on public.editorial_prompt_versions (prompt_id, version_no desc);

create table if not exists public.tag_vocabulary_versions (
    id uuid primary key default gen_random_uuid(),
    version_no integer not null unique check (version_no > 0),
    status text not null default 'draft' check (
        status in ('draft', 'published', 'archived')
    ),
    change_note text not null default '',
    created_by uuid references auth.users(id) on delete set null,
    published_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    published_at timestamptz
);

create unique index if not exists tag_vocabulary_one_published_idx
    on public.tag_vocabulary_versions ((true))
    where status = 'published';

create table if not exists public.tag_categories (
    id uuid primary key default gen_random_uuid(),
    vocabulary_version_id uuid not null
        references public.tag_vocabulary_versions(id) on delete cascade,
    category_key text not null,
    name text not null,
    description text not null default '',
    sort_order integer not null default 0,
    status text not null default 'active' check (
        status in ('active', 'disabled')
    ),
    unique (vocabulary_version_id, category_key)
);

create index if not exists tag_categories_version_sort_idx
    on public.tag_categories (vocabulary_version_id, sort_order, name);

create table if not exists public.tag_terms (
    id uuid primary key default gen_random_uuid(),
    category_id uuid not null references public.tag_categories(id) on delete cascade,
    term_key text not null,
    name text not null,
    description text not null default '',
    synonyms text[] not null default '{}',
    sort_order integer not null default 0,
    status text not null default 'active' check (
        status in ('active', 'disabled')
    ),
    unique (category_id, term_key),
    unique (category_id, name)
);

create index if not exists tag_terms_category_sort_idx
    on public.tag_terms (category_id, sort_order, name);

create table if not exists public.editorial_strategies (
    id uuid primary key default gen_random_uuid(),
    strategy_key text not null unique,
    name text not null,
    use_case text not null default 'default',
    description text not null default '',
    status text not null default 'active' check (
        status in ('active', 'disabled')
    ),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists editorial_strategies_set_updated_at on public.editorial_strategies;
create trigger editorial_strategies_set_updated_at
before update on public.editorial_strategies
for each row execute function public.set_updated_at();

create table if not exists public.editorial_strategy_versions (
    id uuid primary key default gen_random_uuid(),
    strategy_id uuid not null references public.editorial_strategies(id) on delete cascade,
    version_no integer not null check (version_no > 0),
    status text not null default 'draft' check (
        status in ('draft', 'published', 'archived')
    ),
    settings jsonb not null default '{}'::jsonb,
    change_note text not null default '',
    created_by uuid references auth.users(id) on delete set null,
    published_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    published_at timestamptz,
    unique (strategy_id, version_no)
);

create unique index if not exists editorial_strategy_one_published_idx
    on public.editorial_strategy_versions (strategy_id)
    where status = 'published';

create index if not exists editorial_strategy_versions_lookup_idx
    on public.editorial_strategy_versions (strategy_id, version_no desc);

create table if not exists public.audit_logs (
    id bigint generated by default as identity primary key,
    actor_user_id uuid references auth.users(id) on delete set null,
    actor_role text,
    domain text not null check (
        domain in ('platform', 'editorial', 'review', 'auth', 'security')
    ),
    action text not null,
    resource_type text not null,
    resource_id text,
    summary text not null default '',
    before_data jsonb,
    after_data jsonb,
    result text not null default 'success' check (
        result in ('success', 'failure')
    ),
    request_id text,
    ip_address inet,
    created_at timestamptz not null default now()
);

create index if not exists audit_logs_domain_created_idx
    on public.audit_logs (domain, created_at desc);

create index if not exists audit_logs_actor_created_idx
    on public.audit_logs (actor_user_id, created_at desc);

comment on table public.audit_logs is
    'Append-only application audit events. Never store secrets, tokens, passwords, or manuscript bodies.';

alter table public.staff_profiles enable row level security;
alter table public.editorial_prompts enable row level security;
alter table public.editorial_prompt_versions enable row level security;
alter table public.tag_vocabulary_versions enable row level security;
alter table public.tag_categories enable row level security;
alter table public.tag_terms enable row level security;
alter table public.editorial_strategies enable row level security;
alter table public.editorial_strategy_versions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select on public.staff_profiles
for select to authenticated
using (
    user_id = auth.uid()
    or public.current_staff_role() = 'platform_admin'
);

drop policy if exists staff_profiles_platform_insert on public.staff_profiles;
drop policy if exists staff_profiles_platform_update on public.staff_profiles;

-- Internal mutations deliberately have no authenticated RLS policy. The browser uses
-- Supabase only for Auth; every staff/config write must pass through FastAPI, whose
-- service-role client performs RBAC checks, safety checks, and audit logging.

drop policy if exists editorial_prompts_read on public.editorial_prompts;
create policy editorial_prompts_read on public.editorial_prompts
for select to authenticated
using (public.current_staff_role() in ('editorial_lead', 'review_editor'));

drop policy if exists editorial_prompts_manage on public.editorial_prompts;

drop policy if exists editorial_prompt_versions_read on public.editorial_prompt_versions;
create policy editorial_prompt_versions_read on public.editorial_prompt_versions
for select to authenticated
using (
    public.current_staff_role() = 'editorial_lead'
    or (
        public.current_staff_role() = 'review_editor'
        and status = 'published'
    )
);

drop policy if exists editorial_prompt_versions_manage on public.editorial_prompt_versions;

drop policy if exists tag_vocabulary_versions_read on public.tag_vocabulary_versions;
create policy tag_vocabulary_versions_read on public.tag_vocabulary_versions
for select to authenticated
using (
    public.current_staff_role() = 'editorial_lead'
    or (
        public.current_staff_role() = 'review_editor'
        and status = 'published'
    )
);

drop policy if exists tag_vocabulary_versions_manage on public.tag_vocabulary_versions;

drop policy if exists tag_categories_read on public.tag_categories;
create policy tag_categories_read on public.tag_categories
for select to authenticated
using (
    public.current_staff_role() = 'editorial_lead'
    or exists (
        select 1
        from public.tag_vocabulary_versions vocabulary
        where vocabulary.id = vocabulary_version_id
          and vocabulary.status = 'published'
          and public.current_staff_role() = 'review_editor'
    )
);

drop policy if exists tag_categories_manage on public.tag_categories;

drop policy if exists tag_terms_read on public.tag_terms;
create policy tag_terms_read on public.tag_terms
for select to authenticated
using (
    public.current_staff_role() = 'editorial_lead'
    or exists (
        select 1
        from public.tag_categories category
        join public.tag_vocabulary_versions vocabulary
          on vocabulary.id = category.vocabulary_version_id
        where category.id = category_id
          and vocabulary.status = 'published'
          and public.current_staff_role() = 'review_editor'
    )
);

drop policy if exists tag_terms_manage on public.tag_terms;

drop policy if exists editorial_strategies_read on public.editorial_strategies;
create policy editorial_strategies_read on public.editorial_strategies
for select to authenticated
using (public.current_staff_role() in ('editorial_lead', 'review_editor'));

drop policy if exists editorial_strategies_manage on public.editorial_strategies;

drop policy if exists editorial_strategy_versions_read on public.editorial_strategy_versions;
create policy editorial_strategy_versions_read on public.editorial_strategy_versions
for select to authenticated
using (
    public.current_staff_role() = 'editorial_lead'
    or (
        public.current_staff_role() = 'review_editor'
        and status = 'published'
    )
);

drop policy if exists editorial_strategy_versions_manage on public.editorial_strategy_versions;

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
for select to authenticated
using (
    (
        public.current_staff_role() = 'platform_admin'
        and domain in ('platform', 'auth', 'security')
    )
    or (
        public.current_staff_role() = 'editorial_lead'
        and domain in ('editorial', 'review')
    )
    or (
        public.current_staff_role() = 'review_editor'
        and actor_user_id = auth.uid()
    )
);

revoke all privileges on public.staff_profiles from anon, authenticated;
revoke all privileges on public.editorial_prompts from anon, authenticated;
revoke all privileges on public.editorial_prompt_versions from anon, authenticated;
revoke all privileges on public.tag_vocabulary_versions from anon, authenticated;
revoke all privileges on public.tag_categories from anon, authenticated;
revoke all privileges on public.tag_terms from anon, authenticated;
revoke all privileges on public.editorial_strategies from anon, authenticated;
revoke all privileges on public.editorial_strategy_versions from anon, authenticated;
revoke all privileges on public.audit_logs from anon, authenticated;

grant select on public.staff_profiles to authenticated;
grant select on public.editorial_prompts to authenticated;
grant select on public.editorial_prompt_versions to authenticated;
grant select on public.tag_vocabulary_versions to authenticated;
grant select on public.tag_categories to authenticated;
grant select on public.tag_terms to authenticated;
grant select on public.editorial_strategies to authenticated;
grant select on public.editorial_strategy_versions to authenticated;
grant select on public.audit_logs to authenticated;

commit;
