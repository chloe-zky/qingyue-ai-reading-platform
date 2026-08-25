-- Publish the first privacy-first editorial configuration.
--
-- This migration intentionally writes both configuration generations:
--   1. editorial_* versioned tables power the editorial-lead/review UI;
--   2. legacy runtime tables are still read by AI tagging/recommendations.
-- Remove the legacy writes after the runtime has been migrated to the
-- versioned published configuration.

begin;

do $$
begin
    if not exists (
        select 1
        from public.staff_profiles
        where role = 'editorial_lead'
          and status = 'active'
    ) then
        raise exception 'An active editorial_lead is required to publish config v1';
    end if;

    if exists (
        select 1 from public.tag_vocabulary_versions where version_no > 1
    ) then
        raise exception 'A newer tag vocabulary exists; refusing to republish v1';
    end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Prompt: privacy-first metadata tagging
-- -------------------------------------------------------------------------

insert into public.editorial_prompts (
    prompt_key,
    name,
    use_case,
    description,
    status,
    created_by
)
select
    'novel_metadata_tagging',
    '轻阅读小说元数据打标',
    'submission_tagging',
    '仅分析标题、扉页语与内容简介；AI 生成草稿，审稿编辑最终确认。',
    'active',
    lead.user_id
from (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead
on conflict (prompt_key) do update set
    name = excluded.name,
    use_case = excluded.use_case,
    description = excluded.description,
    status = excluded.status;

update public.editorial_prompt_versions
set status = 'archived'
where prompt_id = (
    select id from public.editorial_prompts
    where prompt_key = 'novel_metadata_tagging'
)
  and status = 'published';

insert into public.editorial_prompt_versions (
    prompt_id,
    version_no,
    status,
    system_prompt,
    user_prompt_template,
    variables,
    change_note,
    created_by,
    published_by,
    published_at
)
select
    prompt.id,
    1,
    'published',
    $system$
你是“轻阅读”平台的小说元数据编辑助手，不是审稿决策者。你只能根据标题、扉页语和内容简介生成供编辑审核的标签草稿。正文没有提供，不得假装阅读过正文；证据不足时必须留空，不得为了填满字段而猜测。只输出合法 JSON，不要输出 Markdown、解释或额外字段。
$system$,
    $template$
请分析以下作品元数据：

标题：《{{title}}》
扉页语：{{intro}}
内容简介：{{sample}}

固定标签规则：
1. setting_tags 选择 1 个；明确跨时代时最多 2 个。仅可使用：现代、古风、民国。
2. story_tone_tags 选择 1～2 个。仅可使用：清甜校园、遗憾青春、温暖治愈、浓情曲折。
3. relationship_core_tags 选择 1～2 个。仅可使用：暗恋未明、久别重逢、相伴成长、命运拉扯。
4. aesthetic_tags 选择 1～3 个。仅可使用：清新、细腻、诗意、写实、复古、电影感、烟火气、克制、朦胧、明快、冷峻、浪漫。
5. risk_tags 最多 3 个，没有明确证据时返回空数组。仅可使用：暴力冲突、自伤或自杀、死亡与哀伤、家庭暴力、校园霸凌、控制或 PUA、情感背叛、性暗示、未成年人敏感情节、违法犯罪、恐怖惊吓。
6. recommend_reason 使用 30～60 个中文字符，不剧透，不作“绝对好看”类保证，不提及 AI 或算法。

严格输出：
{
  "setting_tags": [],
  "story_tone_tags": [],
  "relationship_core_tags": [],
  "aesthetic_tags": [],
  "risk_tags": [],
  "recommend_reason": ""
}
$template$,
    '["title", "intro", "sample"]'::jsonb,
    '首版隐私优先打标：正文不发送给 LLM；固定词表、证据不足留空、编辑最终确认。',
    lead.user_id,
    lead.user_id,
    now()
from public.editorial_prompts prompt
cross join lateral (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead
where prompt.prompt_key = 'novel_metadata_tagging'
on conflict (prompt_id, version_no) do update set
    status = excluded.status,
    system_prompt = excluded.system_prompt,
    user_prompt_template = excluded.user_prompt_template,
    variables = excluded.variables,
    change_note = excluded.change_note,
    published_by = excluded.published_by,
    published_at = excluded.published_at;

-- Runtime-compatible combined prompt. The service appends title/intro/sample.
update public.prompt_versions set is_active = false where is_active = true;

do $$
declare
    prompt_body text := $runtime$
你是“轻阅读”平台的小说元数据编辑助手，不是审稿决策者。

你只能根据随后提供的标题、扉页语和内容简介生成供编辑审核的标签草稿。正文没有提供，不得假装阅读过正文；证据不足时必须留空，不得为了填满字段而猜测。

固定标签规则：
1. setting_tags 选择 1 个；明确跨时代时最多 2 个。仅可使用：现代、古风、民国。
2. story_tone_tags 选择 1～2 个。仅可使用：清甜校园、遗憾青春、温暖治愈、浓情曲折。
3. relationship_core_tags 选择 1～2 个。仅可使用：暗恋未明、久别重逢、相伴成长、命运拉扯。
4. aesthetic_tags 选择 1～3 个。仅可使用：清新、细腻、诗意、写实、复古、电影感、烟火气、克制、朦胧、明快、冷峻、浪漫。
5. risk_tags 最多 3 个，没有明确证据时返回空数组。仅可使用：暴力冲突、自伤或自杀、死亡与哀伤、家庭暴力、校园霸凌、控制或 PUA、情感背叛、性暗示、未成年人敏感情节、违法犯罪、恐怖惊吓。
6. recommend_reason 使用 30～60 个中文字符，不剧透，不作“绝对好看”类保证，不提及 AI 或算法。

只输出以下结构的合法 JSON，不得输出 Markdown、解释或额外字段：
{
  "setting_tags": [],
  "story_tone_tags": [],
  "relationship_core_tags": [],
  "aesthetic_tags": [],
  "risk_tags": [],
  "recommend_reason": ""
}
$runtime$;
    schema_body jsonb := $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "setting_tags",
    "story_tone_tags",
    "relationship_core_tags",
    "aesthetic_tags",
    "risk_tags",
    "recommend_reason"
  ],
  "properties": {
    "setting_tags": {"type": "array", "items": {"type": "string"}, "maxItems": 2},
    "story_tone_tags": {"type": "array", "items": {"type": "string"}, "maxItems": 2},
    "relationship_core_tags": {"type": "array", "items": {"type": "string"}, "maxItems": 2},
    "aesthetic_tags": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
    "risk_tags": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
    "recommend_reason": {"type": "string"}
  }
}
$schema$::jsonb;
begin
    if exists (select 1 from public.prompt_versions where version = 'v2') then
        update public.prompt_versions
        set name = '隐私优先元数据打标',
            prompt_text = prompt_body,
            output_schema = schema_body,
            notes = '只分析标题、扉页语与简介；固定标签草稿由编辑确认。',
            is_active = true
        where version = 'v2';
    else
        insert into public.prompt_versions (
            version, name, prompt_text, output_schema, notes, is_active
        ) values (
            'v2',
            '隐私优先元数据打标',
            prompt_body,
            schema_body,
            '只分析标题、扉页语与简介；固定标签草稿由编辑确认。',
            true
        );
    end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Vocabulary: three recommendation dimensions plus controlled AI-only tags
-- -------------------------------------------------------------------------

update public.tag_vocabulary_versions set status = 'archived' where status = 'published';

insert into public.tag_vocabulary_versions (
    version_no, status, change_note, created_by, published_by, published_at
)
select
    1,
    'published',
    '首版受控词表：3 个时代、4 个基调、4 个关系内核；补充受控美学与内部风险提示。',
    lead.user_id,
    lead.user_id,
    now()
from (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead
on conflict (version_no) do update set
    status = excluded.status,
    change_note = excluded.change_note,
    published_by = excluded.published_by,
    published_at = excluded.published_at;

insert into public.tag_categories (
    vocabulary_version_id, category_key, name, description, sort_order, status
)
select vocabulary.id, seed.category_key, seed.name, seed.description, seed.sort_order, 'active'
from public.tag_vocabulary_versions vocabulary
cross join (values
    ('setting', '时代设定', '作品主要发生的时代与社会背景。', 10),
    ('story_tone', '故事基调', '读者将感受到的主要情绪与叙事味道。', 20),
    ('relationship_core', '关系内核', '推动人物情感线的核心关系模式。', 30),
    ('aesthetic', '美学风格', 'AI 可建议、编辑可修正的受控表达风格。', 40),
    ('risk', '内部风险提示', '仅供编辑审核的内容提醒，默认不向读者展示。', 50)
) as seed(category_key, name, description, sort_order)
where vocabulary.version_no = 1
on conflict (vocabulary_version_id, category_key) do update set
    name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    status = excluded.status;

insert into public.tag_terms (
    category_id, term_key, name, description, synonyms, sort_order, status
)
select
    category.id,
    seed.term_key,
    seed.name,
    seed.description,
    seed.synonyms,
    seed.sort_order,
    'active'
from public.tag_categories category
join public.tag_vocabulary_versions vocabulary
  on vocabulary.id = category.vocabulary_version_id
join (values
    ('setting', 'modern', '现代', '当代城市、校园、职场、乡镇或现实生活。', array['当代','都市','现实向']::text[], 10),
    ('setting', 'ancient', '古风', '真实古代或架空王朝背景，具有东方传统社会风貌。', array['古代','架空古代','东方古典']::text[], 20),
    ('setting', 'republican', '民国', '晚清至民国时期的城市、乡土与社会风貌。', array['民国旧影','近代旧城']::text[], 30),
    ('story_tone', 'sweet_campus', '清甜校园', '校园是主要舞台，情感轻盈、纯粹、甜度较高。', array['校园甜恋','青春甜文']::text[], 10),
    ('story_tone', 'regretful_youth', '遗憾青春', '围绕青春、错过、未说出口或无法完成的感情。', array['青春遗憾','错过','意难平']::text[], 20),
    ('story_tone', 'warm_healing', '温暖治愈', '以陪伴、修复、生活希望和情绪安慰为主要体验。', array['治愈系','温情','生活流']::text[], 30),
    ('story_tone', 'intense_twists', '浓情曲折', '情感浓度高，关系反复或情节具有明显戏剧转折。', array['情感拉扯','戏剧性','虐恋情深']::text[], 40),
    ('relationship_core', 'unspoken_crush', '暗恋未明', '至少一方长期隐藏感情，关系尚未被明确表达。', array['单向暗恋','双向暗恋','未说出口']::text[], 10),
    ('relationship_core', 'reunion', '久别重逢', '人物经历较长分离后重新相遇。', array['重逢','多年后再见']::text[], 20),
    ('relationship_core', 'growing_together', '相伴成长', '关系建立在长期陪伴、共同经历和彼此成长上。', array['共同成长','陪伴']::text[], 30),
    ('relationship_core', 'fate_tension', '命运拉扯', '人物受到身份、现实、时代或命运冲突的反复牵引。', array['宿命','身份对立','爱而不得']::text[], 40),
    ('aesthetic', 'fresh', '清新', '轻盈、自然、留白适度。', array[]::text[], 10),
    ('aesthetic', 'delicate', '细腻', '重视细节、感受与微妙心理。', array[]::text[], 20),
    ('aesthetic', 'poetic', '诗意', '语言或意象具有诗性。', array[]::text[], 30),
    ('aesthetic', 'realistic', '写实', '贴近日常生活与真实处境。', array[]::text[], 40),
    ('aesthetic', 'retro', '复古', '具有鲜明的旧时代质感。', array[]::text[], 50),
    ('aesthetic', 'cinematic', '电影感', '画面、场景与节奏具有镜头感。', array[]::text[], 60),
    ('aesthetic', 'everyday_warmth', '烟火气', '日常生活细节温暖鲜活。', array[]::text[], 70),
    ('aesthetic', 'restrained', '克制', '情绪表达含蓄、不直白宣泄。', array[]::text[], 80),
    ('aesthetic', 'hazy', '朦胧', '情绪、记忆或意象具有模糊感。', array[]::text[], 90),
    ('aesthetic', 'bright', '明快', '节奏与情绪总体轻盈明朗。', array[]::text[], 100),
    ('aesthetic', 'austere', '冷峻', '表达清醒、疏离或具有锋利感。', array[]::text[], 110),
    ('aesthetic', 'romantic', '浪漫', '强调理想化情感与浪漫体验。', array[]::text[], 120),
    ('risk', 'violence', '暴力冲突', '存在需要编辑关注的暴力描写。', array[]::text[], 10),
    ('risk', 'self_harm', '自伤或自杀', '涉及自伤、自杀想法或行为。', array[]::text[], 20),
    ('risk', 'death_grief', '死亡与哀伤', '死亡、失去与哀伤是重要内容。', array[]::text[], 30),
    ('risk', 'domestic_violence', '家庭暴力', '涉及家庭成员间的暴力或伤害。', array[]::text[], 40),
    ('risk', 'school_bullying', '校园霸凌', '涉及校园排挤、欺凌或持续伤害。', array[]::text[], 50),
    ('risk', 'coercive_control', '控制或 PUA', '涉及情感控制、操纵或贬损。', array['情感控制']::text[], 60),
    ('risk', 'betrayal', '情感背叛', '涉及明确的亲密关系背叛。', array[]::text[], 70),
    ('risk', 'sexual_suggestion', '性暗示', '涉及需要年龄或场景提示的性暗示。', array[]::text[], 80),
    ('risk', 'minor_sensitive', '未成年人敏感情节', '未成年人相关情节需要编辑额外判断。', array[]::text[], 90),
    ('risk', 'crime', '违法犯罪', '违法犯罪行为是重要情节。', array[]::text[], 100),
    ('risk', 'horror', '恐怖惊吓', '存在明显恐怖或惊吓内容。', array[]::text[], 110)
) as seed(category_key, term_key, name, description, synonyms, sort_order)
  on seed.category_key = category.category_key
where vocabulary.version_no = 1
on conflict (category_id, term_key) do update set
    name = excluded.name,
    description = excluded.description,
    synonyms = excluded.synonyms,
    sort_order = excluded.sort_order,
    status = excluded.status;

-- Legacy runtime vocabulary remains the 11 reader-selectable core terms.
update public.tag_vocabularies vocabulary
set tag_desc = seed.description,
    is_active = true
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
  and vocabulary.tag_name = seed.tag_name;

-- -------------------------------------------------------------------------
-- Recommendation: explainable emotional tag matching
-- -------------------------------------------------------------------------

insert into public.editorial_strategies (
    strategy_key, name, use_case, description, status, created_by
)
select
    'emotional_tag_match',
    '情绪与关系优先推荐',
    'default',
    '小样本阶段使用可解释的三维标签匹配，不启用行为学习。',
    'active',
    lead.user_id
from (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead
on conflict (strategy_key) do update set
    name = excluded.name,
    use_case = excluded.use_case,
    description = excluded.description,
    status = excluded.status;

update public.editorial_strategy_versions
set status = 'archived'
where strategy_id = (
    select id from public.editorial_strategies
    where strategy_key = 'emotional_tag_match'
)
  and status = 'published';

insert into public.editorial_strategy_versions (
    strategy_id,
    version_no,
    status,
    settings,
    change_note,
    created_by,
    published_by,
    published_at
)
select
    strategy.id,
    1,
    'published',
    jsonb_build_object(
        'algorithm', 'weighted_tag_match_v1',
        'weights', jsonb_build_object(
            'setting', 15,
            'story_tone', 40,
            'relationship_core', 45
        ),
        'max_score', 96,
        'result_limit', 6,
        'candidate_filter', jsonb_build_object(
            'book_status', 'active',
            'tag_status', 'confirmed'
        ),
        'cold_start', jsonb_build_object(
            'mode', 'latest_confirmed',
            'limit', 10
        ),
        'tie_breakers', jsonb_build_array('score_desc', 'book_id_desc'),
        'behavior_learning_enabled', false
    ),
    '首版小样本策略：时代 15%、基调 40%、关系 45%，只推荐已发布且标签已确认作品。',
    lead.user_id,
    lead.user_id,
    now()
from public.editorial_strategies strategy
cross join lateral (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead
where strategy.strategy_key = 'emotional_tag_match'
on conflict (strategy_id, version_no) do update set
    status = excluded.status,
    settings = excluded.settings,
    change_note = excluded.change_note,
    published_by = excluded.published_by,
    published_at = excluded.published_at;

update public.recommendation_strategies set is_active = false where is_active = true;

do $$
begin
    if exists (select 1 from public.recommendation_strategies where version = 'v2') then
        update public.recommendation_strategies
        set name = '情绪与关系优先推荐',
            setting_weight = 15,
            story_tone_weight = 40,
            relationship_core_weight = 45,
            max_score = 96,
            notes = '小样本可解释策略；仅 active 作品与 confirmed 标签进入候选。',
            is_active = true
        where version = 'v2';
    else
        insert into public.recommendation_strategies (
            version,
            name,
            setting_weight,
            story_tone_weight,
            relationship_core_weight,
            max_score,
            notes,
            is_active
        ) values (
            'v2',
            '情绪与关系优先推荐',
            15,
            40,
            45,
            96,
            '小样本可解释策略；仅 active 作品与 confirmed 标签进入候选。',
            true
        );
    end if;
end;
$$;

-- Append-only publication audit. Never store prompt bodies or manuscript text.
insert into public.audit_logs (
    actor_user_id,
    actor_role,
    domain,
    action,
    resource_type,
    resource_id,
    summary,
    after_data,
    result
)
select
    lead.user_id,
    'editorial_lead',
    'editorial',
    'config.bootstrap.publish',
    audit.resource_type,
    audit.resource_id,
    audit.summary,
    audit.after_data,
    'success'
from (
    select user_id
    from public.staff_profiles
    where role = 'editorial_lead' and status = 'active'
    order by created_at
    limit 1
) lead
cross join (values
    ('editorial_prompt', 'novel_metadata_tagging:v1', '发布隐私优先小说元数据打标 Prompt v1', '{"version":1,"runtime_version":"v2","manuscript_body_sent":false}'::jsonb),
    ('tag_vocabulary', 'tag_vocabulary:v1', '发布首版受控标签词表 v1', '{"version":1,"category_count":5,"reader_core_term_count":11}'::jsonb),
    ('recommendation_strategy', 'emotional_tag_match:v1', '发布情绪与关系优先推荐策略 v1', '{"version":1,"runtime_version":"v2","weights":{"setting":15,"story_tone":40,"relationship_core":45}}'::jsonb)
) as audit(resource_type, resource_id, summary, after_data)
where not exists (
    select 1
    from public.audit_logs existing
    where existing.action = 'config.bootstrap.publish'
      and existing.resource_type = audit.resource_type
      and existing.resource_id = audit.resource_id
      and existing.result = 'success'
);

commit;
