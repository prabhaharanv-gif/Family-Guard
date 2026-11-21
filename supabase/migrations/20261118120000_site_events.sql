-- ===========================================================================
-- Website funnel counter (ad page views and Play button taps)
-- ===========================================================================
--
-- Meta ads sent visitors to the website but nothing on our side showed how many
-- of them saw the page or tapped Get it on Google Play, so a dead button could
-- not be told apart from a bad ad. This adds a small counter.
--
-- One row per event: a page view of the ad page, or a tap on a Play button.
-- Stored: the event, which button, the utm_ campaign keys from the address, and
-- two coarse flags (opened inside the Instagram or Facebook browser, and the
-- phone platform). Nothing that identifies a person: no IP, no user agent, no id.
--
-- Anyone on the public website must be able to write a row, but must not be
-- able to read, change or delete any. So the table has row level security on
-- with no policies, and the only way in is log_site_event(), which checks and
-- trims every value and drops events when more than 300 arrive in one minute.
--
-- Read the numbers in the dashboard SQL Editor with docs/ad-funnel.sql.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer.
-- ===========================================================================

create table if not exists public.site_events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  event        text    not null check (event in ('page_view', 'download_click')),
  placement    text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  in_app       boolean not null default false,
  platform     text
);

create index if not exists site_events_created_at_idx on public.site_events (created_at desc);

alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;

create or replace function public.log_site_event(
  p_event        text,
  p_placement    text default null,
  p_utm_source   text default null,
  p_utm_medium   text default null,
  p_utm_campaign text default null,
  p_in_app       boolean default false,
  p_platform     text default null
) returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_event is null or p_event not in ('page_view', 'download_click') then
    return;
  end if;

  -- crude flood guard: a script cannot fill the table
  if (select count(*) from public.site_events where created_at > now() - interval '1 minute') >= 300 then
    return;
  end if;

  insert into public.site_events (event, placement, utm_source, utm_medium, utm_campaign, in_app, platform)
  values (
    p_event,
    left(p_placement, 20),
    left(p_utm_source, 80),
    left(p_utm_medium, 80),
    left(p_utm_campaign, 80),
    coalesce(p_in_app, false),
    case when p_platform in ('android', 'ios', 'other') then p_platform else null end
  );
end;
$function$;

revoke all on function public.log_site_event(text, text, text, text, text, boolean, text) from public;
grant execute on function public.log_site_event(text, text, text, text, text, boolean, text) to anon, authenticated;
