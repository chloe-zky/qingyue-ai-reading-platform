-- Fix publish_reviewed_book for the deployed book_ai_tags schema.
--
-- book_ai_tags stores controlled-tag lists as jsonb. The original function
-- aggregated JSON strings into PostgreSQL text[] values, so every approval
-- failed atomically with SQLSTATE 42804 before a book could become active.

begin;

create or replace function public.publish_reviewed_book(
    p_book_id bigint,
    p_actor uuid,
    p_tags jsonb default '{}'::jsonb,
    p_cover jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_status text;
    v_claimed_by uuid;
    v_claim_expires_at timestamptz;
    v_tag_key text;
begin
    select status, review_claimed_by, review_claim_expires_at
      into v_status, v_claimed_by, v_claim_expires_at
      from public.books
     where id = p_book_id
     for update;

    if not found then
        raise exception '稿件不存在: %', p_book_id using errcode = 'no_data_found';
    end if;
    if v_status is distinct from 'pending_review' then
        raise exception '稿件当前状态为 %，不能重复审核通过', coalesce(v_status, 'unknown')
            using errcode = 'invalid_parameter_value';
    end if;
    if p_actor is null
       or not exists (
           select 1 from public.staff_profiles
            where user_id = p_actor and role = 'review_editor' and status = 'active'
       ) then
        raise exception '当前编辑账号无权发布稿件' using errcode = 'insufficient_privilege';
    end if;
    if v_claimed_by is distinct from p_actor then
        raise exception '请先认领该稿件后再发布' using errcode = 'insufficient_privilege';
    end if;
    if v_claim_expires_at is null or v_claim_expires_at <= now() then
        raise exception '审稿认领已过期，请重新认领' using errcode = 'serialization_failure';
    end if;
    if p_tags is null or jsonb_typeof(p_tags) is distinct from 'object' then
        raise exception '标签参数必须是 JSON 对象' using errcode = 'invalid_parameter_value';
    end if;
    if p_cover is null or jsonb_typeof(p_cover) is distinct from 'object' then
        raise exception '配图参数必须是 JSON 对象' using errcode = 'invalid_parameter_value';
    end if;

    foreach v_tag_key in array array[
        'setting_tags',
        'story_tone_tags',
        'relationship_core_tags',
        'aesthetic_tags',
        'risk_tags'
    ] loop
        if jsonb_typeof(coalesce(p_tags -> v_tag_key, '[]'::jsonb)) is distinct from 'array' then
            raise exception '标签字段 % 必须是 JSON 数组', v_tag_key
                using errcode = 'invalid_parameter_value';
        end if;
    end loop;

    insert into public.book_ai_tags as t (
        book_id, setting_tags, story_tone_tags, relationship_core_tags,
        aesthetic_tags, risk_tags, recommend_reason, tag_status, tag_source
    )
    values (
        p_book_id,
        coalesce(p_tags -> 'setting_tags', '[]'::jsonb),
        coalesce(p_tags -> 'story_tone_tags', '[]'::jsonb),
        coalesce(p_tags -> 'relationship_core_tags', '[]'::jsonb),
        coalesce(p_tags -> 'aesthetic_tags', '[]'::jsonb),
        coalesce(p_tags -> 'risk_tags', '[]'::jsonb),
        coalesce(p_tags ->> 'recommend_reason', ''),
        'confirmed',
        'ai_reviewed'
    )
    on conflict (book_id) do update set
        setting_tags = excluded.setting_tags,
        story_tone_tags = excluded.story_tone_tags,
        relationship_core_tags = excluded.relationship_core_tags,
        aesthetic_tags = excluded.aesthetic_tags,
        risk_tags = excluded.risk_tags,
        recommend_reason = excluded.recommend_reason,
        tag_status = 'confirmed',
        tag_source = 'ai_reviewed';

    update public.books
       set status = 'active',
           cover_image_url = coalesce(p_cover ->> 'cover_image_url', ''),
           cover_photographer = coalesce(p_cover ->> 'cover_photographer', ''),
           cover_caption = coalesce(p_cover ->> 'cover_caption', ''),
           reviewed_at = now(),
           review_claimed_by = null,
           review_claimed_at = null,
           review_claim_expires_at = null
     where id = p_book_id
       and status = 'pending_review';

    if not found then
        raise exception '发布失败：稿件状态在本次事务中被并发修改'
            using errcode = 'serialization_failure';
    end if;

    return jsonb_build_object(
        'book_id', p_book_id,
        'article_status', 'active',
        'tag_status', 'confirmed'
    );
end $$;

revoke all on function public.publish_reviewed_book(bigint, uuid, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.publish_reviewed_book(bigint, uuid, jsonb, jsonb)
    to service_role;

commit;
