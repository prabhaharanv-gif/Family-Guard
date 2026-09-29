-- ===========================================================================
-- Re-register the data-retention cron jobs
-- ===========================================================================
--
-- retention_job_1 through 5 were defined in the original baseline schema
-- (20260828000000_baseline_schema_snapshot.sql) but the 2026-09-28 follow-up
-- audit found none of them registered in cron.job live. Whatever purged them
-- (a cron table reset, a project pause/restore, a manual unschedule) is not
-- recoverable from here; this just puts them back. Same SQL as the baseline.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

select cron.schedule('retention_job_1', '0 2 * * *', $cron$DELETE FROM public.messages
    WHERE created_at < NOW() - INTERVAL '90 days';$cron$);
select cron.schedule('retention_job_2', '0 2 * * *', $cron$DELETE FROM public.sos_alerts
    WHERE is_resolved = true
      AND created_at < NOW() - INTERVAL '30 days';$cron$);
select cron.schedule('retention_job_3', '0 3 * * 0', $cron$DELETE FROM public.message_reads
    WHERE message_id NOT IN (SELECT id FROM public.messages);$cron$);
select cron.schedule('retention_job_4', '0 3 * * 0', $cron$DELETE FROM public.device_tokens
    WHERE updated_at < NOW() - INTERVAL '60 days';$cron$);
select cron.schedule('retention_job_5', '0 3 * * *', $cron$DELETE FROM public.location_history WHERE recorded_at < NOW() - INTERVAL '7 days';$cron$);
