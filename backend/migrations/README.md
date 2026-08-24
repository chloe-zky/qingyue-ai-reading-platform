# Supabase migration order

These files are intentionally not executed automatically against the hosted project.

1. Back up the current schema and important rows from the Supabase dashboard.
2. Run `20260820_editor_decisions.sql` if the `books` table does not yet contain the
   revision/rejection columns and status values.
3. Run `20260820_staff_roles_and_editorial_config.sql` once.
4. Create the first Supabase Auth user in **Authentication → Users**.
5. Bootstrap exactly one platform administrator in the SQL editor, replacing the
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

