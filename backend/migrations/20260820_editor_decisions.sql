begin;

alter table public.books
    add column if not exists editor_feedback text not null default '',
    add column if not exists reviewed_at timestamptz;

alter table public.books
    drop constraint if exists books_status_check;

alter table public.books
    add constraint books_status_check
    check (status in ('pending_review', 'active', 'rejected', 'revision_requested'));

create index if not exists books_status_id_idx
    on public.books (status, id);

comment on column public.books.editor_feedback is
    'Latest editor feedback shown to the author after rejection or revision request.';

comment on column public.books.reviewed_at is
    'UTC timestamp of the latest editor decision.';

commit;
