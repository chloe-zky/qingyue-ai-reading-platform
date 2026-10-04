# Supabase migration order

These files are intentionally not executed automatically against the hosted project.
Apply them in the exact order below. Never run a rollback or data-cleanup file as part
of a normal forward deployment.

1. Back up the current schema and important rows from the Supabase dashboard.
2. For a completely empty project, run `20260819_base_schema.sql`. Existing projects
   that already have the base catalog tables may skip it because later migrations use
   `if exists` / `if not exists` where appropriate.
3. Apply the forward migrations in this order:

   1. `20260820_editor_decisions.sql`
   2. `20260820_staff_roles_and_editorial_config.sql`
   3. `20260824_author_access_review_claims.sql`
   4. `20260824_editorial_config_v1.sql`
   5. `20260824_editorial_config_mutations.sql`
   6. `20260825_reader_accounts.sql`
   7. `20260825_lightweight_personalization.sql`
   8. `20260825_secure_runtime_and_atomic_personalization.sql`
   9. `20260831_reader_daily_preferences.sql`
   10. `20260831_recommendation_context.sql`
   11. `20260831_publish_invariant.sql`
   12. `20260831_fix_publish_reviewed_book_jsonb.sql`
   13. `20260831_normalize_retained_books.sql`
   14. `20260903_normalize_recent_cover_images.sql`
   15. `20261004_release_hardening.sql`

   `20260831_purge_test_books.sql` is an optional, destructive one-off cleanup and is
   deliberately excluded from the normal sequence.
4. From `backend/`, run the read-only verification command:

   ```bash
   python -m tools.check_deployment
   ```

5. Create the first Supabase Auth user in **Authentication → Users**.
6. Bootstrap exactly one platform administrator in the SQL editor, replacing the
   email and display name below:

```sql
insert into public.staff_profiles (
    user_id,
    display_name,
    role,
    status
)
select
    id,
    '平台管理员',
    'platform_admin',
    'active'
from auth.users
where lower(email) = lower('replace-with-your-email@example.com')
on conflict (user_id) do update
set
    display_name = excluded.display_name,
    role = excluded.role,
    status = excluded.status;
```

Confirm that the statement affected one row. After this bootstrap, staff invitations,
role changes, and account disabling should be performed through the platform-admin API
so each change is audited.

## Role values

- `platform_admin`: technical configuration and staff identity administration.
- `editorial_lead`: Prompt, vocabulary, recommendation strategy, and editorial audit.
- `review_editor`: submission review and the user's own review history.

An account has one role. Do not create a shared role account or expose the service-role
key to the browser.

## Rollback

`20260820_staff_roles_and_editorial_config.rollback.sql` removes only the tables and
functions introduced by the corresponding migration. It is destructive and should be
used only before real editorial configuration or audit data is stored.
