-- Applied through equivalent service-role updates on 2026-09-03.
-- Recent PDF-derived covers are normalized to the same immutable 720px JPEG
-- layout already used by the retained recommendation-pool books.

begin;

update public.books
set cover_image_url = case id
  when 23 then 'https://jiyhjoomwwzoffhucnep.supabase.co/storage/v1/object/public/covers/optimized/book-23-720.jpg'
  when 25 then 'https://jiyhjoomwwzoffhucnep.supabase.co/storage/v1/object/public/covers/optimized/book-25-720.jpg'
  when 26 then 'https://jiyhjoomwwzoffhucnep.supabase.co/storage/v1/object/public/covers/optimized/book-26-720.jpg'
end
where (id, title) in (
  (23, '无人之境'),
  (25, '西窗烛'),
  (26, '于无声处')
);

commit;
