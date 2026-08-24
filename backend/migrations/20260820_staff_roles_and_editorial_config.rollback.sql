begin;

drop table if exists public.audit_logs cascade;
drop table if exists public.editorial_strategy_versions cascade;
drop table if exists public.editorial_strategies cascade;
drop table if exists public.tag_terms cascade;
drop table if exists public.tag_categories cascade;
drop table if exists public.tag_vocabulary_versions cascade;
drop table if exists public.editorial_prompt_versions cascade;
drop table if exists public.editorial_prompts cascade;
drop table if exists public.staff_profiles cascade;

drop function if exists public.current_staff_role();

-- public.set_updated_at() is deliberately retained because another project migration
-- may already use this generic helper.

commit;
