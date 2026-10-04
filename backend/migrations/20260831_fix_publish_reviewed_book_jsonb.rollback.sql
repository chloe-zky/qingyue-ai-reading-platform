-- Removing the corrected function is safer than restoring the known-broken
-- text[] implementation. Reapply the forward migration to restore publishing.

begin;

drop function if exists public.publish_reviewed_book(bigint, uuid, jsonb, jsonb);

commit;
