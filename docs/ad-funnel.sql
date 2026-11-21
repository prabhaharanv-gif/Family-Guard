-- Ad funnel counts from the website counter (table site_events, see
-- supabase/migrations/20261118120000_site_events.sql).
-- Run in the Supabase dashboard SQL Editor. Times are shown in India time.
-- NOTE: no apostrophes in comments (the SQL Editor splits statements naively).

-- 1. Per day and campaign: ad page opened, Play button tapped, tap rate
select (created_at at time zone 'Asia/Kolkata')::date              as day,
       coalesce(utm_campaign, '(none)')                             as campaign,
       count(*) filter (where event = 'page_view')                  as page_views,
       count(*) filter (where event = 'download_click')             as play_taps,
       round(100.0 * count(*) filter (where event = 'download_click')
             / nullif(count(*) filter (where event = 'page_view'), 0), 1) as tap_rate_pct
  from public.site_events
 group by 1, 2
 order by 1 desc, 2;

-- 2. Same, split by inside Instagram / Facebook browser or not
select in_app,
       count(*) filter (where event = 'page_view')      as page_views,
       count(*) filter (where event = 'download_click') as play_taps
  from public.site_events
 where created_at > now() - interval '7 days'
 group by in_app;

-- 3. Latest 30 events, to confirm a test tap was recorded
select created_at at time zone 'Asia/Kolkata' as at_ist, event, placement, utm_campaign, in_app, platform
  from public.site_events
 order by id desc
 limit 30;
