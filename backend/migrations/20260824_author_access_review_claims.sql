begin;

create extension if not exists pgcrypto;

alter table public.books
    add column if not exists author_access_token_hash text,
    add column if not exists current_revision_no integer not null default 1,
    add column if not exists review_claimed_by uuid references public.staff_profiles(user_id) on delete set null,
    add column if not exists review_claimed_at timestamptz,
    add column if not exists review_claim_expires_at timestamptz;

update public.books
set author_access_token_hash = encode(digest(gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex')
where author_access_token_hash is null;

alter table public.books
    alter column author_access_token_hash set not null;

-- All book access goes through FastAPI's service-role client. This prevents the
-- new receipt hash (and unpublished manuscripts) from being exposed through the
-- browser-facing PostgREST API even if legacy default grants still exist.
alter table public.books enable row level security;
revoke all on public.books from anon, authenticated;
grant all on public.books to service_role;

alter table public.books
    drop constraint if exists books_author_access_token_hash_check;
alter table public.books
    add constraint books_author_access_token_hash_check
    check (author_access_token_hash ~ '^[0-9a-f]{64}$');

create index if not exists books_review_claim_queue_idx
    on public.books (status, review_claim_expires_at, id);
create index if not exists books_review_claim_owner_idx
    on public.books (review_claimed_by, status);

create table if not exists public.submission_revisions (
    id bigint generated always as identity primary key,
    book_id bigint not null references public.books(id) on delete cascade,
    revision_no integer not null check (revision_no > 0),
    title text not null,
    author text not null,
    intro text not null,
    sample text not null,
    full_content text not null default '',
    submitted_at timestamptz not null default now(),
    unique (book_id, revision_no)
);

create index if not exists submission_revisions_book_idx
    on public.submission_revisions (book_id, revision_no desc);

insert into public.submission_revisions (
    book_id, revision_no, title, author, intro, sample, full_content, submitted_at
)
select
    id, 1, title, author, intro, sample, coalesce(full_content, ''), coalesce(created_at, now())
from public.books
on conflict (book_id, revision_no) do nothing;

alter table public.submission_revisions enable row level security;
revoke all on public.submission_revisions from anon, authenticated;
grant all on public.submission_revisions to service_role;
grant usage, select on sequence public.submission_revisions_id_seq to service_role;

comment on column public.books.author_access_token_hash is
    'SHA-256 hash of the opaque author receipt token; the raw token is never stored.';
comment on table public.submission_revisions is
    'Immutable snapshots for every author submission and resubmission.';
comment on column public.books.review_claim_expires_at is
    'Short review lease expiry; expired leases may be reclaimed by another review editor.';

create or replace function public.submit_author_article_secure(
    p_title text,
    p_author text,
    p_intro text,
    p_sample text,
    p_full_content text,
    p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    created_book public.books%rowtype;
begin
    if p_token_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid author access token hash';
    end if;

    insert into public.books (
        title, author, intro, sample, full_content, status,
        author_access_token_hash, current_revision_no
    ) values (
        p_title, p_author, p_intro, p_sample, coalesce(p_full_content, ''),
        'pending_review', p_token_hash, 1
    ) returning * into created_book;

    insert into public.submission_revisions (
        book_id, revision_no, title, author, intro, sample, full_content
    ) values (
        created_book.id, 1, p_title, p_author, p_intro, p_sample,
        coalesce(p_full_content, '')
    );

    return jsonb_build_object(
        'book_id', created_book.id,
        'revision_no', 1,
        'submitted_at', created_book.created_at
    );
end;
$$;

create or replace function public.resubmit_author_article_secure(
    p_book_id bigint,
    p_token_hash text,
    p_title text,
    p_author text,
    p_intro text,
    p_sample text,
    p_full_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    target public.books%rowtype;
    next_revision integer;
begin
    select * into target
    from public.books
    where id = p_book_id
    for update;

    if not found or target.author_access_token_hash <> p_token_hash then
        raise exception 'invalid author receipt';
    end if;
    if target.status not in ('revision_requested', 'rejected') then
        raise exception 'submission is not open for resubmission';
    end if;

    next_revision := target.current_revision_no + 1;
    insert into public.submission_revisions (
        book_id, revision_no, title, author, intro, sample, full_content
    ) values (
        p_book_id, next_revision, p_title, p_author, p_intro, p_sample,
        coalesce(p_full_content, '')
    );

    delete from public.book_ai_tags where book_id = p_book_id;

    update public.books
    set title = p_title,
        author = p_author,
        intro = p_intro,
        sample = p_sample,
        full_content = coalesce(p_full_content, ''),
        status = 'pending_review',
        editor_feedback = '',
        reviewed_at = null,
        current_revision_no = next_revision,
        review_claimed_by = null,
        review_claimed_at = null,
        review_claim_expires_at = null
    where id = p_book_id;

    return jsonb_build_object(
        'book_id', p_book_id,
        'revision_no', next_revision,
        'submitted_at', now()
    );
end;
$$;

create or replace function public.claim_submission_for_review(
    p_book_id bigint,
    p_actor uuid,
    p_lease_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    target public.books%rowtype;
    expiry timestamptz;
begin
    if not exists (
        select 1 from public.staff_profiles
        where user_id = p_actor and role = 'review_editor' and status = 'active'
    ) then
        raise exception 'actor is not an active review editor';
    end if;

    select * into target from public.books where id = p_book_id for update;
    if not found then raise exception 'submission not found'; end if;
    if target.status <> 'pending_review' then raise exception 'submission is not pending review'; end if;
    if target.review_claimed_by is not null
       and target.review_claimed_by <> p_actor
       and target.review_claim_expires_at > now() then
        raise exception 'submission is claimed by another editor';
    end if;

    expiry := now() + make_interval(mins => greatest(5, least(coalesce(p_lease_minutes, 30), 120)));
    update public.books
    set review_claimed_by = p_actor,
        review_claimed_at = now(),
        review_claim_expires_at = expiry
    where id = p_book_id;

    return jsonb_build_object('book_id', p_book_id, 'claimed', true, 'expires_at', expiry);
end;
$$;

create or replace function public.release_submission_review_claim(
    p_book_id bigint,
    p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.books
    set review_claimed_by = null,
        review_claimed_at = null,
        review_claim_expires_at = null
    where id = p_book_id and review_claimed_by = p_actor;
    return jsonb_build_object('book_id', p_book_id, 'claimed', false);
end;
$$;

revoke all on function public.submit_author_article_secure(text,text,text,text,text,text) from public;
revoke all on function public.resubmit_author_article_secure(bigint,text,text,text,text,text,text) from public;
revoke all on function public.claim_submission_for_review(bigint,uuid,integer) from public;
revoke all on function public.release_submission_review_claim(bigint,uuid) from public;
revoke all on function public.submit_author_article_secure(text,text,text,text,text,text) from anon, authenticated;
revoke all on function public.resubmit_author_article_secure(bigint,text,text,text,text,text,text) from anon, authenticated;
revoke all on function public.claim_submission_for_review(bigint,uuid,integer) from anon, authenticated;
revoke all on function public.release_submission_review_claim(bigint,uuid) from anon, authenticated;

grant execute on function public.submit_author_article_secure(text,text,text,text,text,text) to service_role;
grant execute on function public.resubmit_author_article_secure(bigint,text,text,text,text,text,text) to service_role;
grant execute on function public.claim_submission_for_review(bigint,uuid,integer) to service_role;
grant execute on function public.release_submission_review_claim(bigint,uuid) to service_role;

commit;
