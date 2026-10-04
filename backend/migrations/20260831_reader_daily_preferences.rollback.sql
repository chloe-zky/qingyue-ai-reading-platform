-- Removes only what 20260831_reader_daily_preferences.sql introduced.
-- Destructive: every reader's stored daily selections are dropped. Long-term
-- reader_profiles data is untouched by design.
begin;

drop index if exists public.reader_daily_preferences_date_idx;
drop table if exists public.reader_daily_preferences;

commit;
