-- ===========================================================================
-- Famora Social: nearby-help escalation for SOS
--
-- When a family is too far away to help in person, this finds the 10 closest
-- opted-in Famora users near the SOS location and asks them, and only them,
-- to call local emergency services (112) on the senders behalf. It never
-- asks anyone to travel to the location themselves. Escalates radius and
-- wait time in three tiers (2km/1min, 5km/2min, 10km/3min) if nobody
-- accepts, then tells the family to call 112 directly.
--
-- Reuses existing plumbing rather than inventing new infrastructure:
--   - trg_notify_edge_function -> data-only FCM push (same as SOS itself)
--   - pg_cron + pg_net (already enabled, already wired to Vault) as the
--     escalation timer, since no wait-then-act pattern exists yet
--   - user_consents for the opt-in flag, same shape ConsentGate already uses
--
-- send_sos_all_families inserts one sos_alerts row PER FAMILY a sender
-- belongs to for a single physical SOS. sos_group_id dedupes that so only
-- one escalation is ever started per real-world event.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

-- ── 1. Dedup key on sos_alerts, one group id per physical SOS event ─────────

alter table public.sos_alerts add column if not exists sos_group_id uuid;

CREATE OR REPLACE FUNCTION public.send_sos(p_family_id uuid, p_lat double precision, p_lng double precision, p_message text DEFAULT 'SOS! I need help!'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_lat  is null or p_lat  < -90  or p_lat  > 90  then
    raise exception 'Invalid latitude: %',  p_lat  using errcode = '22023';
  end if;
  if p_lng  is null or p_lng  < -180 or p_lng  > 180 then
    raise exception 'Invalid longitude: %', p_lng  using errcode = '22023';
  end if;

  if p_message is null or trim(p_message) = '' then
    raise exception 'SOS message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_message) > 500 then
    raise exception 'SOS message too long (max 500 chars)' using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  insert into sos_alerts (user_id, family_id, lat, lng, message, sos_group_id)
  values (v_uid, p_family_id, p_lat, p_lng, p_message, gen_random_uuid())
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_sos_all_families(
  p_lat     double precision,
  p_lng     double precision,
  p_message text default 'SOS! I need help!'
)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_ids      uuid[] := '{}';
  v_id       uuid;
  v_group_id uuid := gen_random_uuid();
  r          record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_lat is null or p_lat < -90 or p_lat > 90 then
    raise exception 'Invalid latitude: %', p_lat using errcode = '22023';
  end if;
  if p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid longitude: %', p_lng using errcode = '22023';
  end if;
  if p_message is null or trim(p_message) = '' then
    raise exception 'SOS message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_message) > 500 then
    raise exception 'SOS message too long (max 500 chars)' using errcode = '22023';
  end if;

  for r in
    select distinct family_id from family_members where user_id = v_uid
  loop
    insert into sos_alerts (user_id, family_id, lat, lng, message, sos_group_id)
    values (v_uid, r.family_id, p_lat, p_lng, p_message, v_group_id)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'Not a member of any family' using errcode = 'PGRST116';
  end if;

  return v_ids;
end;
$function$;

-- ── 2. New tables ────────────────────────────────────────────────────────

create table public.nearby_help_escalations (
  id               uuid primary key default gen_random_uuid(),
  sos_group_id     uuid not null,
  sos_alert_id     uuid not null references public.sos_alerts(id) on delete cascade,
  requester_id     uuid not null references auth.users(id) on delete cascade,
  lat              double precision not null,
  lng              double precision not null,
  status           text not null default 'searching'
                     check (status in ('searching','helper_found','exhausted','resolved')),
  current_tier     smallint not null default 0,
  tier_deadline_at timestamptz,
  accepted_by      uuid references auth.users(id) on delete set null,
  accepted_at      timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint nearby_help_escalations_group_unique unique (sos_group_id)
);

create index nearby_help_escalations_sos_alert_id_idx on public.nearby_help_escalations (sos_alert_id);

create table public.nearby_help_notifications (
  id              uuid primary key default gen_random_uuid(),
  escalation_id   uuid not null references public.nearby_help_escalations(id) on delete cascade,
  tier            smallint not null,
  helper_id       uuid not null references auth.users(id) on delete cascade,
  distance_m      double precision not null,
  fuzzy_lat       double precision not null,
  fuzzy_lng       double precision not null,
  fuzzy_radius_m  integer not null default 400,
  notified_at     timestamptz not null default now(),
  responded_at    timestamptz,
  response        text check (response in ('accepted','declined')),
  constraint nearby_help_notifications_escalation_helper_unique unique (escalation_id, helper_id)
);

create index nearby_help_notifications_pending_idx
  on public.nearby_help_notifications (helper_id) where response is null;

-- ── 3. RLS — one PERMISSIVE policy per table, see the sharing-check lesson
--    in 20260831120000_enforce_location_sharing_in_rls.sql ─────────────────

alter table public.nearby_help_escalations enable row level security;

create policy "escalation visible to requester, family, or notified helper"
  on public.nearby_help_escalations as PERMISSIVE for SELECT to public
  using (
    requester_id = auth.uid()
    or exists (
      select 1 from public.sos_alerts sa
      where sa.id = nearby_help_escalations.sos_alert_id
        and public.is_family_member(sa.family_id)
    )
    or exists (
      select 1 from public.nearby_help_notifications n
      where n.escalation_id = nearby_help_escalations.id
        and n.helper_id = auth.uid()
    )
  );

create policy "service_role_all_nearby_help_escalations" on public.nearby_help_escalations
  as PERMISSIVE for ALL to service_role using (true) with check (true);

alter table public.nearby_help_notifications enable row level security;

create policy "helper reads own notification" on public.nearby_help_notifications
  as PERMISSIVE for SELECT to public using (helper_id = auth.uid());

create policy "service_role_all_nearby_help_notifications" on public.nearby_help_notifications
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- No client UPDATE policy on either table. All writes go through the
-- SECURITY DEFINER RPCs below, same convention as resolve_sos vs a direct
-- sos_alerts write.

-- ── 4. Realtime — guarded add, see 20260829150000_device_ping_notifications ─

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'nearby_help_escalations'
  ) then
    alter publication supabase_realtime add table public.nearby_help_escalations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'nearby_help_notifications'
  ) then
    alter publication supabase_realtime add table public.nearby_help_notifications;
  end if;
end $$;

-- ── 5. Nearest-N lookup ──────────────────────────────────────────────────
--
-- No PostGIS extension exists in this project; all existing distance math
-- (src/lib/route.js) is plain haversine. This stays consistent: a lat/lng
-- bounding-box prefilter (cheap, index-friendly) followed by haversine on
-- the small remaining set. If the opted-in user base grows large, PostGIS
-- plus a GiST index is the more scalable answer later.
--
-- SECURITY DEFINER, no grant to authenticated: exposing raw radius search to
-- clients would let anyone enumerate strangers approximate locations, which
-- is exactly what the fuzzy-until-accepted rule exists to prevent. Only the
-- internal functions below call this.

CREATE OR REPLACE FUNCTION public.find_nearest_opted_in_users(
  p_lat double precision, p_lng double precision, p_radius_m double precision,
  p_requester_id uuid, p_exclude_user_ids uuid[], p_limit int default 10
) RETURNS table(user_id uuid, distance_m double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  with candidates as (
    select distinct on (l.user_id) l.user_id, l.lat, l.lng
    from public.locations l
    join public.user_consents c
      on c.user_id = l.user_id and c.consent_type = 'famora_social_visibility'
    where l.is_sharing = true
      and l.lat is not null and l.lng is not null
      and not (l.lat = 0 and l.lng = 0)
      and l.updated_at > now() - interval '30 minutes'
      and l.user_id <> p_requester_id
      and l.user_id <> all(p_exclude_user_ids)
      and l.lat between p_lat - (p_radius_m / 111000.0) and p_lat + (p_radius_m / 111000.0)
      and l.lng between p_lng - (p_radius_m / 111000.0 / cos(radians(p_lat)))
                     and p_lng + (p_radius_m / 111000.0 / cos(radians(p_lat)))
    order by l.user_id, l.updated_at desc
  ), distanced as (
    select user_id,
      2 * 6371000 * asin(sqrt(
        sin(radians(lat - p_lat) / 2) ^ 2
        + cos(radians(p_lat)) * cos(radians(lat)) * sin(radians(lng - p_lng) / 2) ^ 2
      )) as distance_m
    from candidates
  )
  select user_id, distance_m from distanced
  where distance_m <= p_radius_m
  order by distance_m asc
  limit p_limit;
$function$;

-- Ambient map RPC, separate from the SOS flow. Returns fuzzed coordinates
-- only, recomputed fresh on every call (unlike the persisted per-notification
-- fuzz below, since there is no accept/reveal lifecycle tied to this one) and
-- never a user_id or any identity — this is the browsing map, not targeted.
CREATE OR REPLACE FUNCTION public.list_famora_social_dots(
  p_center_lat double precision, p_center_lng double precision, p_radius_m double precision default 15000
) RETURNS table(lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    l.lat + (random() - 0.5) * 2 * (400 / 111320.0),
    l.lng + (random() - 0.5) * 2 * (400 / 111320.0 / cos(radians(l.lat)))
  from (
    select distinct on (user_id) user_id, lat, lng
    from public.locations
    where is_sharing = true and lat is not null and lng is not null
      and not (lat = 0 and lng = 0)
      and updated_at > now() - interval '30 minutes'
      and user_id <> auth.uid()
    order by user_id, updated_at desc
  ) l
  join public.user_consents c
    on c.user_id = l.user_id and c.consent_type = 'famora_social_visibility'
  where l.lat between p_center_lat - (p_radius_m / 111000.0) and p_center_lat + (p_radius_m / 111000.0)
    and l.lng between p_center_lng - (p_radius_m / 111000.0 / cos(radians(p_center_lat)))
                   and p_center_lng + (p_radius_m / 111000.0 / cos(radians(p_center_lat)));
$function$;

revoke execute on function public.list_famora_social_dots(double precision, double precision, double precision) from public, anon;
grant  execute on function public.list_famora_social_dots(double precision, double precision, double precision) to authenticated, service_role;

-- ── 6. Escalation state machine ──────────────────────────────────────────
--
-- pg_cron has no true one-shot primitive. This schedules a NAMED job at a
-- specific future minute (so it fires exactly once in practice) and has the
-- job unschedule itself the moment it runs. advance_nearby_help_tier always
-- re-checks status='searching' before doing anything, so a stray survivor
-- (a Postgres restart mid-window, say) just no-ops instead of misfiring.
-- The cleanup job in section 8 sweeps up any leftover job rows.

CREATE OR REPLACE FUNCTION public._nearby_help_safe_unschedule(p_job_name text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform cron.unschedule(p_job_name);
exception when others then
  null; -- job may already be gone; nothing to do
end;
$function$;

CREATE OR REPLACE FUNCTION public._nearby_help_notify_tier(
  p_escalation_id uuid, p_tier smallint, p_radius_m double precision
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_esc      record;
  v_wait_min int;
  v_job      text;
  v_when     timestamp;
begin
  select * into v_esc from public.nearby_help_escalations where id = p_escalation_id for update;
  if not found or v_esc.status <> 'searching' then return; end if;

  insert into public.nearby_help_notifications
    (escalation_id, tier, helper_id, distance_m, fuzzy_lat, fuzzy_lng)
  select
    p_escalation_id, p_tier, f.user_id, f.distance_m,
    v_esc.lat + (random() - 0.5) * 2 * (400 / 111320.0),
    v_esc.lng + (random() - 0.5) * 2 * (400 / 111320.0 / cos(radians(v_esc.lat)))
  from public.find_nearest_opted_in_users(
    v_esc.lat, v_esc.lng, p_radius_m, v_esc.requester_id,
    coalesce(
      (select array_agg(helper_id) from public.nearby_help_notifications where escalation_id = p_escalation_id),
      '{}'
    ),
    10
  ) f
  on conflict (escalation_id, helper_id) do nothing;

  v_wait_min := case p_tier when 1 then 1 when 2 then 2 else 3 end;

  update public.nearby_help_escalations
    set current_tier = p_tier, tier_deadline_at = now() + (v_wait_min || ' minutes')::interval
    where id = p_escalation_id;

  v_job  := 'nearby_help_tier_' || replace(p_escalation_id::text, '-', '');
  v_when := (now() at time zone 'UTC') + (v_wait_min || ' minutes')::interval;

  perform public._nearby_help_safe_unschedule(v_job);
  perform cron.schedule(
    v_job,
    format('%s %s %s %s *',
      extract(minute from v_when)::int, extract(hour  from v_when)::int,
      extract(day    from v_when)::int, extract(month from v_when)::int),
    format('select public.advance_nearby_help_tier(%L::uuid)', p_escalation_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.advance_nearby_help_tier(p_escalation_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_esc record;
  v_job text := 'nearby_help_tier_' || replace(p_escalation_id::text, '-', '');
begin
  perform public._nearby_help_safe_unschedule(v_job);

  select * into v_esc from public.nearby_help_escalations where id = p_escalation_id for update;
  if not found or v_esc.status <> 'searching' then return; end if;

  if v_esc.current_tier = 1 then
    perform public._nearby_help_notify_tier(p_escalation_id, 2, 5000);
  elsif v_esc.current_tier = 2 then
    perform public._nearby_help_notify_tier(p_escalation_id, 3, 10000);
  else
    update public.nearby_help_escalations set status = 'exhausted' where id = p_escalation_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public._start_nearby_help_escalation()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id       uuid;
  v_group_id uuid;
begin
  if new.lat = 0 and new.lng = 0 then return new; end if;

  -- send_sos / send_sos_all_families always set sos_group_id already; this
  -- coalesce is only a backstop for a future insert path that forgets to.
  v_group_id := coalesce(new.sos_group_id, gen_random_uuid());

  insert into public.nearby_help_escalations (sos_group_id, sos_alert_id, requester_id, lat, lng)
  values (v_group_id, new.id, new.user_id, new.lat, new.lng)
  on conflict (sos_group_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform public._nearby_help_notify_tier(v_id, 1, 2000);
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_start_nearby_help_escalation on public.sos_alerts;
create trigger trg_start_nearby_help_escalation
  AFTER INSERT on public.sos_alerts
  for each row EXECUTE FUNCTION public._start_nearby_help_escalation();

-- ── 7. Accept / decline / reveal RPCs ────────────────────────────────────
--
-- Same shape as resolve_sos: auth check, row lock, state check, one focused
-- update. errcode 22023 on an already-decided escalation matches the
-- already-resolved convention SOSPage.jsx / useSOS.js already treat as a
-- non-error outcome.

CREATE OR REPLACE FUNCTION public.accept_nearby_help(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_notif record;
  v_esc   record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_notif from public.nearby_help_notifications where id = p_notification_id;
  if not found or v_notif.helper_id <> v_uid then
    raise exception 'Not authorized' using errcode = 'PGRST301';
  end if;
  if v_notif.response is not null then
    raise exception 'You already responded to this request' using errcode = '22023';
  end if;

  select * into v_esc from public.nearby_help_escalations where id = v_notif.escalation_id for update;
  if v_esc.status <> 'searching' then
    raise exception 'This request already has help arranged, or has ended' using errcode = '22023';
  end if;

  update public.nearby_help_notifications
    set response = 'accepted', responded_at = now()
    where id = p_notification_id;

  update public.nearby_help_escalations
    set status = 'helper_found', accepted_by = v_uid, accepted_at = now()
    where id = v_esc.id;

  perform public._nearby_help_safe_unschedule('nearby_help_tier_' || replace(v_esc.id::text, '-', ''));
end;
$function$;

CREATE OR REPLACE FUNCTION public.decline_nearby_help(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  update public.nearby_help_notifications
    set response = 'declined', responded_at = now()
    where id = p_notification_id and helper_id = v_uid and response is null;
end;
$function$;

-- The sole reveal path. Never returns the requesters name or phone, only
-- the raw coordinates, and only to the one helper who accepted.
CREATE OR REPLACE FUNCTION public.get_nearby_help_location(p_escalation_id uuid)
 RETURNS table(lat double precision, lng double precision)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select sa.lat, sa.lng
  from public.nearby_help_escalations e
  join public.sos_alerts sa on sa.id = e.sos_alert_id
  where e.id = p_escalation_id
    and e.status = 'helper_found'
    and e.accepted_by = auth.uid();
$function$;

revoke execute on function public.accept_nearby_help(uuid)     from public, anon;
revoke execute on function public.decline_nearby_help(uuid)    from public, anon;
revoke execute on function public.get_nearby_help_location(uuid) from public, anon;
grant  execute on function public.accept_nearby_help(uuid)     to authenticated, service_role;
grant  execute on function public.decline_nearby_help(uuid)    to authenticated, service_role;
grant  execute on function public.get_nearby_help_location(uuid) to authenticated, service_role;

-- ── 8. Resolve cascade — additive change to the existing resolve_sos ───────
--
-- Existing behavior, callers and error codes are unchanged; this only adds
-- telling any notified/accepted helpers that the emergency is over, so they
-- do not keep trying to help one that has ended.

CREATE OR REPLACE FUNCTION public.resolve_sos(p_sos_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_alert sos_alerts%rowtype;
  v_esc_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_alert
  from sos_alerts
  where id = p_sos_id;

  if not found then
    raise exception 'SOS alert not found' using errcode = 'P0002';
  end if;

  if v_alert.is_resolved then
    raise exception 'SOS alert is already resolved' using errcode = '22023';
  end if;

  if not is_family_member(v_alert.family_id) then
    raise exception 'Not authorized to resolve this SOS' using errcode = 'PGRST301';
  end if;

  update sos_alerts
  set
    is_resolved = true,
    resolved_by = v_uid,
    resolved_at = now()
  where id = p_sos_id;

  select id into v_esc_id from public.nearby_help_escalations
    where sos_alert_id = p_sos_id and status in ('searching','helper_found');

  if v_esc_id is not null then
    update public.nearby_help_escalations
      set status = 'resolved', resolved_at = now()
      where id = v_esc_id;
    perform public._nearby_help_safe_unschedule('nearby_help_tier_' || replace(v_esc_id::text, '-', ''));
  end if;
end;
$function$;

-- ── 9. Push triggers — reuse the existing generic webhook function ─────────
--
-- Both point at the same new edge function, which branches on TG_TABLE_NAME
-- and record/old_record, the same way send-sos-notification already
-- branches on record.is_resolved from two different call sites.

drop trigger if exists nearby_help_notify_tier on public.nearby_help_notifications;
create trigger nearby_help_notify_tier
  AFTER INSERT on public.nearby_help_notifications
  for each row EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-nearby-help-notification');

drop trigger if exists nearby_help_status_change on public.nearby_help_escalations;
create trigger nearby_help_status_change
  AFTER UPDATE on public.nearby_help_escalations
  for each row when (new.status is distinct from old.status)
  EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-nearby-help-notification');

-- ── 10. Cleanup — sweep any leftover escalation cron jobs ──────────────────
--
-- advance_nearby_help_tier always re-checks status before acting, so a
-- surviving job is harmless, but it would otherwise sit in cron.job forever.
-- This mirrors the existing daily retention_job_* jobs below it.

select cron.schedule('nearby_help_cron_cleanup', '30 3 * * *', $cron$
  select cron.unschedule(j.jobname)
  from cron.job j
  where j.jobname like 'nearby_help_tier_%'
    and j.jobid in (
      select job.jobid from cron.job job
      join public.nearby_help_escalations e
        on job.jobname = 'nearby_help_tier_' || replace(e.id::text, '-', '')
      where e.status <> 'searching' or e.created_at < now() - interval '1 day'
    );
$cron$);
