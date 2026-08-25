begin;

drop function if exists public.release_submission_review_claim(bigint,uuid);
drop function if exists public.claim_submission_for_review(bigint,uuid,integer);
drop function if exists public.resubmit_author_article_secure(bigint,text,text,text,text,text,text);
drop function if exists public.submit_author_article_secure(text,text,text,text,text,text);

drop table if exists public.submission_revisions;

drop index if exists public.books_review_claim_owner_idx;
drop index if exists public.books_review_claim_queue_idx;

alter table public.books
    drop constraint if exists books_author_access_token_hash_check,
    drop column if exists review_claim_expires_at,
    drop column if exists review_claimed_at,
    drop column if exists review_claimed_by,
    drop column if exists current_revision_no,
    drop column if exists author_access_token_hash;

commit;
