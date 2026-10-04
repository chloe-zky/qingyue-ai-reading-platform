-- 20260831_publish_invariant.sql
--
-- 目标：让「已公开的作品必须有已确认标签」成为**数据库层面的不变量**，
-- 而不只是服务层的约定。
--
-- 背景：approve_submission 目前是两次独立的 PostgREST 调用
--   ① upsert book_ai_tags (tag_status='confirmed')
--   ② update books (status='active')
-- 中间任何一步失败，都会留下 active+draft 或 confirmed+未发布的半成品。
-- 线上曾出现 4 篇 active+draft（ID 1/2/3/5），靠推荐侧 confirmed 过滤才没露出来。
--
-- 执行状态：已于 2026-08-31 经 Supabase SQL Editor 执行；服务已切换到
-- publish_reviewed_book，函数执行权仅授予 service_role。
--
-- 跨表约束无法用 CHECK 表达（CHECK 不能引用其它表），因此用触发器。

begin;

-- ── 1. 原子发布：状态与标签在同一个事务里一起落地 ──────────────────
--
-- 函数体本身就是一个事务：任一步 raise 都会整体回滚，不会留下半成品。
create or replace function public.publish_reviewed_book(
    p_book_id    bigint,
    p_actor      uuid,
    p_tags       jsonb default '{}'::jsonb,
    p_cover      jsonb default '{}'::jsonb
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
begin
    -- 行锁：并发下第二个调用会等待，拿到锁后状态已不是 pending_review，直接被拒。
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

    -- 先确认标签，再公开作品。顺序不能反：下面 books 的触发器要求
    -- 置为 active 时标签已经是 confirmed。
    insert into public.book_ai_tags as t (
        book_id, setting_tags, story_tone_tags, relationship_core_tags,
        aesthetic_tags, risk_tags, recommend_reason, tag_status, tag_source
    )
    values (
        p_book_id,
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_tags -> 'setting_tags')), '{}'),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_tags -> 'story_tone_tags')), '{}'),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_tags -> 'relationship_core_tags')), '{}'),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_tags -> 'aesthetic_tags')), '{}'),
        coalesce((select array_agg(value::text) from jsonb_array_elements_text(p_tags -> 'risk_tags')), '{}'),
        coalesce(p_tags ->> 'recommend_reason', ''),
        'confirmed',
        'ai_reviewed'
    )
    on conflict (book_id) do update set
        setting_tags           = excluded.setting_tags,
        story_tone_tags        = excluded.story_tone_tags,
        relationship_core_tags = excluded.relationship_core_tags,
        aesthetic_tags         = excluded.aesthetic_tags,
        risk_tags              = excluded.risk_tags,
        recommend_reason       = excluded.recommend_reason,
        tag_status             = 'confirmed',
        tag_source             = 'ai_reviewed';

    update public.books
       set status            = 'active',
           cover_image_url   = coalesce(p_cover ->> 'cover_image_url', ''),
           cover_photographer= coalesce(p_cover ->> 'cover_photographer', ''),
           cover_caption     = coalesce(p_cover ->> 'cover_caption', ''),
           reviewed_at       = now(),
           review_claimed_by = null,
           review_claimed_at = null,
           review_claim_expires_at = null
     where id = p_book_id
       and status = 'pending_review';

    if not found then
        raise exception '发布失败：稿件状态在本次事务中被并发修改' using errcode = 'serialization_failure';
    end if;

    return jsonb_build_object(
        'book_id', p_book_id,
        'article_status', 'active',
        'tag_status', 'confirmed'
    );
end $$;

revoke all on function public.publish_reviewed_book(bigint, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_reviewed_book(bigint, uuid, jsonb, jsonb) to service_role;

-- ── 2. 数据库不变量：active 必须有 confirmed 标签 ─────────────────
--
-- 这层保护覆盖并发写入与绕过服务层的直接写库（含 SQL Editor 手工改数据）。

create or replace function public.assert_book_publish_invariant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_book_id bigint;
begin
    -- Trigger records have a table-specific composite type. Directly mentioning
    -- NEW.book_id in the books trigger (even in an unreachable CASE branch)
    -- raises "record new has no field book_id". JSON conversion safely reads
    -- whichever key exists for INSERT/UPDATE/DELETE on both tables.
    v_book_id := coalesce(
        (to_jsonb(new) ->> 'id')::bigint,
        (to_jsonb(old) ->> 'id')::bigint,
        (to_jsonb(new) ->> 'book_id')::bigint,
        (to_jsonb(old) ->> 'book_id')::bigint
    );

    if exists (
        select 1 from public.books where id = v_book_id and status = 'active'
    ) and not exists (
        select 1 from public.book_ai_tags
         where book_id = v_book_id and tag_status = 'confirmed'
    ) then
            raise exception
                '作品 % 处于 active 但没有已确认标签', v_book_id
                using errcode = 'integrity_constraint_violation';
    end if;

    -- 标签行若被移动到另一本书，还要检查旧作品是否因此失去唯一 confirmed 标签。
    if tg_table_name = 'book_ai_tags'
       and tg_op = 'UPDATE'
       and (to_jsonb(old) ->> 'book_id') is distinct from (to_jsonb(new) ->> 'book_id')
       and exists (
           select 1 from public.books
            where id = (to_jsonb(old) ->> 'book_id')::bigint and status = 'active'
       )
       and not exists (
           select 1 from public.book_ai_tags
            where book_id = (to_jsonb(old) ->> 'book_id')::bigint and tag_status = 'confirmed'
       ) then
            raise exception
                '作品 % 处于 active 但没有已确认标签', (to_jsonb(old) ->> 'book_id')::bigint
                using errcode = 'integrity_constraint_violation';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end $$;

revoke all on function public.assert_book_publish_invariant() from public, anon, authenticated;

-- 使用延迟约束触发器，在事务结束时检查最终状态。这样既能阻止直接删除/降级
-- active 作品的 confirmed 标签，也不会阻塞删除作品时的 FK cascade。
drop trigger if exists books_publish_invariant on public.books;
create constraint trigger books_publish_invariant
after insert or update or delete on public.books
deferrable initially deferred
for each row execute function public.assert_book_publish_invariant();

drop trigger if exists book_tags_confirm_invariant on public.book_ai_tags;
create constraint trigger book_tags_confirm_invariant
after insert or update or delete on public.book_ai_tags
deferrable initially deferred
for each row execute function public.assert_book_publish_invariant();

-- ── 3. 上线前自检：现存数据必须已满足不变量 ────────────────────────
-- 阶段 1 清理后库中只剩 15/16，两篇均 active+confirmed，此处应为 0。
do $$
declare violations integer;
begin
    select count(*) into violations
      from public.books b
     where b.status = 'active'
       and not exists (
           select 1 from public.book_ai_tags t
            where t.book_id = b.id and t.tag_status = 'confirmed'
       );
    if violations > 0 then
        raise exception
            '仍有 % 篇 active 作品没有已确认标签，请先修数据再加约束', violations;
    end if;
end $$;

commit;
