begin;

drop function if exists public.update_llm_config_atomic(
    text, text, text, integer, integer, text, text, text
);
drop function if exists public.update_staff_account_atomic(
    uuid, uuid, text, text, text
);
drop function if exists public.create_internal_review_book(
    uuid, text, text, text, text, text, text
);

commit;
