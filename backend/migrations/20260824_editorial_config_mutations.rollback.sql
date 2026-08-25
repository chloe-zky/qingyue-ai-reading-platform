begin;

drop function if exists public.rollback_tag_vocabulary_version(integer, text, uuid);
drop function if exists public.publish_tag_vocabulary_version(uuid, uuid);
drop function if exists public.clone_published_tag_vocabulary(text, uuid);
drop function if exists public.rollback_editorial_strategy_version(uuid, integer, text, uuid);
drop function if exists public.publish_editorial_strategy_version(uuid, integer, uuid);
drop function if exists public.rollback_editorial_prompt_version(uuid, integer, text, uuid);
drop function if exists public.publish_editorial_prompt_version(uuid, integer, uuid);
drop function if exists public.assert_active_editorial_lead(uuid);

commit;
