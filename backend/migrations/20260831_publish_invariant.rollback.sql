begin;

drop trigger if exists book_tags_confirm_invariant on public.book_ai_tags;
drop trigger if exists books_publish_invariant on public.books;
drop function if exists public.assert_book_publish_invariant();
drop function if exists public.publish_reviewed_book(bigint, uuid, jsonb, jsonb);

commit;
