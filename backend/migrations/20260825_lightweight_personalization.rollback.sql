begin;

drop index if exists public.feedbacks_reader_book_idx;
drop index if exists public.recommendation_logs_reader_recent_idx;

alter table if exists public.feedbacks
    drop column if exists reader_user_id;
alter table if exists public.recommendation_logs
    drop column if exists reader_user_id;

alter table if exists public.reading_history
    drop column if exists last_request_id,
    drop column if exists preference_signal_score,
    drop column if exists completion_count,
    drop column if exists open_count,
    drop column if exists active_seconds;

alter table if exists public.reader_profiles
    drop column if exists preference_updated_at,
    drop column if exists preference_weights,
    drop column if exists personalization_enabled;

commit;
