-- Applied through equivalent service-role PostgREST updates on 2026-08-31.
-- Keep the original PNG objects in Storage; point the two retained books at
-- immutable 720px JPEG display variants and normalize risk tags to vocabulary v1.

begin;

update public.books
set cover_image_url = case id
  when 15 then 'https://jiyhjoomwwzoffhucnep.supabase.co/storage/v1/object/public/covers/optimized/book-15-720.jpg'
  when 16 then 'https://jiyhjoomwwzoffhucnep.supabase.co/storage/v1/object/public/covers/optimized/book-16-720.jpg'
end
where (id, title) in ((15, '致陆东青'), (16, '致唐鸢'));

update public.book_ai_tags
set risk_tags = case book_id
  when 15 then '["情感背叛", "性暗示", "死亡与哀伤"]'::jsonb
  when 16 then '["情感背叛", "性暗示", "违法犯罪"]'::jsonb
end
where book_id in (15, 16)
  and tag_status = 'confirmed';

do $$
declare
  retained_count integer;
  normalized_count integer;
begin
  select count(*) into retained_count
  from public.books
  where (id, title) in ((15, '致陆东青'), (16, '致唐鸢'));

  select count(*) into normalized_count
  from public.book_ai_tags
  where book_id in (15, 16)
    and tag_status = 'confirmed';

  if retained_count <> 2 or normalized_count <> 2 then
    raise exception 'retained-book normalization invariant failed';
  end if;
end $$;

commit;
