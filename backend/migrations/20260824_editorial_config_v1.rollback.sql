-- Immediate rollback for 20260824_editorial_config_v1.sql.
-- Do not run after editors have created newer versions without reviewing the
-- delete scope below. Audit history remains append-only.

begin;

do $$
begin
    if not exists (select 1 from public.prompt_versions where version = 'v1') then
        raise exception 'Legacy prompt v1 is missing; refusing rollback';
    end if;
    if not exists (select 1 from public.recommendation_strategies where version = 'v1') then
        raise exception 'Legacy recommendation strategy v1 is missing; refusing rollback';
    end if;
end;
$$;

delete from public.editorial_prompts
where prompt_key = 'novel_metadata_tagging';

delete from public.tag_vocabulary_versions
where version_no = 1;

delete from public.editorial_strategies
where strategy_key = 'emotional_tag_match';

delete from public.prompt_versions where version = 'v2';
update public.prompt_versions set is_active = false;
update public.prompt_versions set is_active = true where version = 'v1';

delete from public.recommendation_strategies where version = 'v2';
update public.recommendation_strategies set is_active = false;
update public.recommendation_strategies set is_active = true where version = 'v1';

update public.tag_vocabularies vocabulary
set tag_desc = null
from (values
    ('setting', '现代', '当代城市、校园、职场、乡镇或现实生活。'),
    ('setting', '古风', '真实古代或架空王朝背景，具有东方传统社会风貌。'),
    ('setting', '民国', '晚清至民国时期的城市、乡土与社会风貌。'),
    ('story_tone', '清甜校园', '校园是主要舞台，情感轻盈、纯粹、甜度较高。'),
    ('story_tone', '遗憾青春', '围绕青春、错过、未说出口或无法完成的感情。'),
    ('story_tone', '温暖治愈', '以陪伴、修复、生活希望和情绪安慰为主要体验。'),
    ('story_tone', '浓情曲折', '情感浓度高，关系反复或情节具有明显戏剧转折。'),
    ('relationship_core', '暗恋未明', '至少一方长期隐藏感情，关系尚未被明确表达。'),
    ('relationship_core', '久别重逢', '人物经历较长分离后重新相遇。'),
    ('relationship_core', '相伴成长', '关系建立在长期陪伴、共同经历和彼此成长上。'),
    ('relationship_core', '命运拉扯', '人物受到身份、现实、时代或命运冲突的反复牵引。')
) as seed(tag_type, tag_name, description)
where vocabulary.tag_type = seed.tag_type
  and vocabulary.tag_name = seed.tag_name
  and vocabulary.tag_desc = seed.description;

insert into public.audit_logs (
    actor_user_id,
    actor_role,
    domain,
    action,
    resource_type,
    resource_id,
    summary,
    result
)
select
    lead.user_id,
    'editorial_lead',
    'editorial',
    'config.bootstrap.rollback',
    'editorial_configuration',
    'editorial-config-v1',
    '回滚首版 Prompt、标签词表与推荐策略，恢复旧版运行配置',
    'success'
from (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead;

commit;
