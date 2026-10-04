-- 20260831_purge_test_books.sql
--
-- 一次性数据清理：删除 7 篇测试文章（books.id = 1..7）及其全部关联数据。
-- 必须保留 books.id = 15《致陆东青》与 16《致唐鸢》及其标签、正文、封面。
--
-- ⚠ 执行状态：本文件是**等价 SQL 记录**，不是实际执行路径。
--   本轮删除已于 2026-08-31 通过 PostgREST（service_role）按外键安全顺序执行完毕，
--   原因是本机没有 Supabase SQL Editor 通道，无法取得单事务原子性。
--   保留本文件用于复现、审阅与回归；如需在别的环境重放，直接在 SQL Editor 执行本事务即可。
--
-- 为什么按顺序删子表而不是依赖 cascade：
--   五张关联表虽然都是 on delete cascade，但显式删除能逐表核对行数，
--   出错时也不会因为 cascade 把预期外的表一起清空。
--
-- 关于 Storage：covers 桶实测只有 2 个对象，且经 books.cover_image_url 比对
--   确认分别属于 15/16。7 篇测试文章的 cover_image_url 全为空，
--   没有任何可确认归属于它们的对象，因此 **一个 Storage 对象都不删除**。

begin;

-- 前置断言：目标集合必须恰好是这 7 个 id，且不含保留项。
do $$
declare
    target_count integer;
    keep_count integer;
begin
    select count(*) into target_count from public.books where id in (1,2,3,4,5,6,7);
    if target_count <> 7 then
        raise exception '目标文章数不是 7（实际 %），中止以免误删', target_count;
    end if;
    select count(*) into keep_count from public.books where id in (15,16);
    if keep_count <> 2 then
        raise exception '保留文章 15/16 不完整（实际 %），中止', keep_count;
    end if;
end $$;

-- 1) 五张有 books.id 外键的子表（顺序无所谓，但都必须先于 books）
delete from public.book_ai_tags         where book_id in (1,2,3,4,5,6,7);  -- 实际删除 7
delete from public.submission_revisions where book_id in (1,2,3,4,5,6,7);  -- 实际删除 7
delete from public.feedbacks            where book_id in (1,2,3,4,5,6,7);  -- 实际删除 2
delete from public.reading_history      where book_id in (1,2,3,4,5,6,7);  -- 实际删除 2
delete from public.reader_favorites     where book_id in (1,2,3,4,5,6,7);  -- 实际删除 0

-- 2) recommendation_logs 没有 book_id 外键，文章 id 存在 result_book_ids 数组里。
--    结果全部是测试文章的日志已无信息价值 → 删除（实际 463 条）。
delete from public.recommendation_logs
where result_book_ids <@ array[1,2,3,4,5,6,7]
  and array_length(result_book_ids, 1) is not null;

--    结果里同时含保留文章的日志 → 只剔除测试文章 id，保留其余（实际 93 条）。
--    result_scores 与 result_book_ids 是平行数组，必须按同一组下标同步剔除，
--    否则分数会与文章错位。
update public.recommendation_logs rl
set result_book_ids = sub.ids,
    result_scores   = case when sub.score_len = sub.orig_len then sub.scores else rl.result_scores end
from (
    select l.id,
           array_agg(v.book_id order by v.ord) filter (where v.book_id <> all (array[1,2,3,4,5,6,7])) as ids,
           array_agg(l.result_scores[v.ord] order by v.ord) filter (where v.book_id <> all (array[1,2,3,4,5,6,7])) as scores,
           coalesce(array_length(l.result_scores, 1), 0) as score_len,
           coalesce(array_length(l.result_book_ids, 1), 0) as orig_len
    from public.recommendation_logs l,
         lateral unnest(l.result_book_ids) with ordinality as v(book_id, ord)
    where l.result_book_ids && array[1,2,3,4,5,6,7]
      and not (l.result_book_ids <@ array[1,2,3,4,5,6,7])
    group by l.id, l.result_scores, l.result_book_ids
) as sub
where rl.id = sub.id;

-- 3) 最后删主表（实际 7 行）
delete from public.books where id in (1,2,3,4,5,6,7);

-- 4) 审计留痕（不含正文与密钥）
insert into public.audit_logs (domain, action, resource_type, resource_id, summary, after_data, result)
values (
    'platform', 'books.purge_test_data', 'book', '1,2,3,4,5,6,7',
    '删除 7 篇测试文章及其全部关联数据；保留 books 15/16 及其标签、正文、封面',
    jsonb_build_object(
        'deleted', jsonb_build_object('books',7,'book_ai_tags',7,'submission_revisions',7,
                                      'feedbacks',2,'reading_history',2,'reader_favorites',0,
                                      'recommendation_logs',463),
        'sanitized', jsonb_build_object('recommendation_logs_result_book_ids',93),
        'storage_objects_deleted', 0,
        'preserved_book_ids', jsonb_build_array(15,16)
    ),
    'success'
);

-- 5) 后置断言
do $$
declare leftover integer;
begin
    select count(*) into leftover from public.books where id in (1,2,3,4,5,6,7);
    if leftover <> 0 then raise exception '仍有目标文章残留：%', leftover; end if;
    select count(*) into leftover from public.books where id in (15,16);
    if leftover <> 2 then raise exception '保留文章丢失，实际 %', leftover; end if;
end $$;

commit;
