begin;

-- Refuse a destructive rollback while an encrypted key is still present.
-- First use the backend rotation tool in restore mode or configure a replacement
-- secret store; never drop the only decryptable copy of the AI credential.
do $$
begin
    if to_regclass('public.system_config_secrets') is not null
       and exists (select 1 from public.system_config_secrets) then
        raise exception 'rollback refused: encrypted runtime secrets must be safely restored first';
    end if;
end;
$$;

drop index if exists public.books_active_recommendation_idx;
drop index if exists public.book_ai_tags_confirmed_book_idx;
drop index if exists public.feedbacks_reader_request_book_uidx;

drop function if exists public.get_book_quality_scores(bigint[]);
drop function if exists public.record_reader_feedback_atomic(uuid, text, bigint, text, text, jsonb, text);
drop function if exists public.record_reader_progress_atomic(uuid, bigint, integer, integer, boolean, text);
drop function if exists public.set_reader_favorite_atomic(uuid, bigint, boolean);
drop function if exists public._apply_book_preference_signal(uuid, bigint, double precision, text[]);
drop function if exists public.store_encrypted_system_secret(text, text, text, text);
drop table if exists public.system_config_secrets;

commit;
