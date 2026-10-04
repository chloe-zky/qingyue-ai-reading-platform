-- Collapse strategy, catalog, confirmed tags, quality, reader profile and
-- feedback into one service-role roundtrip. Ranking remains in Python so the
-- existing explainable scoring semantics stay unchanged.
begin;

create or replace function public.get_recommendation_context(
    p_reader_user_id uuid default null,
    p_limit integer default 500
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with published_strategy as (
    select jsonb_build_object(
        'version', 'editorial-v' || v.version_no,
        'setting_weight', coalesce((v.settings -> 'weights' ->> 'setting')::double precision, 0),
        'story_tone_weight', coalesce((v.settings -> 'weights' ->> 'story_tone')::double precision, 0),
        'relationship_core_weight', coalesce((v.settings -> 'weights' ->> 'relationship_core')::double precision, 0),
        'max_score', coalesce((v.settings ->> 'max_score')::double precision, 96),
        'result_limit', coalesce((v.settings ->> 'result_limit')::integer, 6),
        'cold_start_limit', coalesce((v.settings -> 'cold_start' ->> 'limit')::integer, 10)
    ) as value
      from public.editorial_strategies s
      join public.editorial_strategy_versions v on v.strategy_id = s.id
     where s.strategy_key = 'emotional_tag_match'
       and s.status = 'active'
       and v.status = 'published'
     order by v.version_no desc
     limit 1
), legacy_strategy as (
    select jsonb_build_object(
        'version', r.version,
        'setting_weight', r.setting_weight,
        'story_tone_weight', r.story_tone_weight,
        'relationship_core_weight', r.relationship_core_weight,
        'max_score', r.max_score,
        'result_limit', 6,
        'cold_start_limit', 10
    ) as value
      from public.recommendation_strategies r
     where r.is_active = true
       and not exists (select 1 from published_strategy)
     limit 1
), chosen_strategy as (
    select value from published_strategy
    union all
    select value from legacy_strategy
    limit 1
), candidate_rows as materialized (
    select b.id, b.title, b.author, b.intro, b.cover_image_url,
           b.cover_photographer, b.cover_caption, b.created_at,
           t.setting_tags, t.story_tone_tags, t.relationship_core_tags,
           t.recommend_reason, t.created_at as tag_created_at
      from public.books b
      join public.book_ai_tags t on t.book_id = b.id
     where b.status = 'active' and t.tag_status = 'confirmed'
     order by b.created_at desc, b.id desc
     limit least(greatest(coalesce(p_limit, 500), 1), 500)
), quality_raw as (
    select c.id as book_id,
           coalesce(h.score, 0) + coalesce(f.score, 0) as score
      from candidate_rows c
      left join (
          select h.book_id,
                 sum(2 * h.completion_count
                     + least(h.active_seconds / 300.0, 1)
                     + least(h.open_count, 3) * 0.2) as score
            from public.reading_history h
           where h.book_id in (select id from candidate_rows)
           group by h.book_id
      ) h on h.book_id = c.id
      left join (
          select f.book_id, count(*) * 3.0 as score
            from public.reader_favorites f
           where f.book_id in (select id from candidate_rows)
           group by f.book_id
      ) f on f.book_id = c.id
), quality as (
    select q.*, max(q.score) over () as maximum from quality_raw q
), candidates as (
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'title', c.title,
            'author', c.author,
            'intro', c.intro,
            'cover_image_url', c.cover_image_url,
            'cover_photographer', c.cover_photographer,
            'cover_caption', c.cover_caption,
            'created_at', c.created_at,
            'book_id', c.id,
            'setting_tags', c.setting_tags,
            'story_tone_tags', c.story_tone_tags,
            'relationship_core_tags', c.relationship_core_tags,
            'recommend_reason', c.recommend_reason,
            'tag_created_at', c.tag_created_at,
            'quality_score', case when q.maximum > 0 then q.score / q.maximum else 0 end
        ) order by c.created_at desc, c.id desc
    ), '[]'::jsonb) as value
      from candidate_rows c
      join quality q on q.book_id = c.id
), reader_profile as (
    select jsonb_build_object(
        'personalization_enabled', p.personalization_enabled,
        'preference_weights', p.preference_weights,
        'preference_updated_at', p.preference_updated_at
    ) as value
      from public.reader_profiles p
     where p.user_id = p_reader_user_id
     limit 1
), reader_feedback as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'book_id', f.book_id, 'reason', f.reason
    ) order by f.created_at desc), '[]'::jsonb) as value
      from (
          select book_id, reason, created_at
            from public.feedbacks
           where p_reader_user_id is not null
             and reader_user_id = p_reader_user_id
           order by created_at desc
           limit 1000
      ) f
)
select jsonb_build_object(
    'strategy', (select value from chosen_strategy),
    'candidates', (select value from candidates),
    'reader_profile', (select value from reader_profile),
    'feedbacks', (select value from reader_feedback)
);
$$;

revoke all on function public.get_recommendation_context(uuid, integer)
    from public, anon, authenticated;
grant execute on function public.get_recommendation_context(uuid, integer)
    to service_role;

commit;
