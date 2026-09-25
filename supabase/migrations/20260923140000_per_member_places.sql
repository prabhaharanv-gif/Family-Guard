-- ===========================================================================
-- Per-member Places (geofencing) -- replaces the unused family-scoped
-- geofences table with a per-user one
--
-- geofences (in the baseline schema) was family-scoped and never wired to
-- any RPC, trigger, edge function or app code -- checked, zero references
-- outside its own DDL. Places are per-member by design (a persons Home does
-- not change depending on which family circle they belong to), so rather
-- than adapt a schema shaped for the wrong ownership model, it is dropped
-- and replaced outright. Two overlapping geofencing schemas is worse than
-- one clean one.
--
-- places is keyed by user_id alone, not (user_id, family_id) like
-- locations/device_tokens/family_members. That is a new pattern in this
-- schema, deliberately: a place is not family-specific.
--
-- Family members never read each others exact place coordinates -- RLS on
-- places is owner-only. Only the arrival/departure EVENT (a name and a
-- yes/no) is shared, via place_events, which is deliberately more private
-- than showing everyone a pin on the map.
--
-- place_events gets one row PER FAMILY the member belongs to when a
-- transition is confirmed, mirroring send_sos_all_families (see
-- 20260917160000_send_sos_all_families.sql) so the existing AFTER-INSERT
-- trg_notify_edge_function plumbing is reused unchanged instead of
-- inventing an UPDATE-trigger with distance math in Postgres.
--
-- radius_m defaults to 150, a fresh choice for v1, not inherited from the
-- old geofences default of 200.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

begin;

drop table if exists public.geofences cascade;

create table public.places (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  lat              double precision not null,
  lng              double precision not null,
  radius_m         integer not null default 150,
  currently_inside boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint places_lat_range check (lat between -90 and 90),
  constraint places_lng_range check (lng between -180 and 180),
  constraint places_radius_range check (radius_m between 30 and 2000)
);
-- A table-level UNIQUE constraint cannot take an expression like lower(name),
-- only a plain column list -- a unique INDEX can, and save_places own
-- "on conflict (user_id, lower(name))" matches it by that same expression.
create unique index places_user_id_name_key on public.places (user_id, lower(name));
alter table public.places enable row level security;

create policy "owner reads own places" on public.places
  for select to authenticated using (auth.uid() = user_id);
create policy "owner writes own places" on public.places
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.place_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  place_id    uuid references public.places(id) on delete set null,
  place_name  text not null,
  entered     boolean not null,
  occurred_at timestamptz not null default now()
);
alter table public.place_events enable row level security;

create policy "family reads place events" on public.place_events
  for select to authenticated using (
    exists (
      select 1 from family_members fm
      where fm.family_id = place_events.family_id and fm.user_id = auth.uid()
    )
  );
-- Written only by report_place_transition (security definer), never
-- directly by a client -- same shape as family_members lock-down.
create policy "no direct client insert on place_events" on public.place_events
  for insert to authenticated with check (false);

create function public.save_place(
  p_name text,
  p_lat  double precision,
  p_lng  double precision
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 then
    raise exception 'Invalid latitude: %', p_lat using errcode = '22023';
  end if;
  if p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid longitude: %', p_lng using errcode = '22023';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'Place name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_name) > 60 then
    raise exception 'Place name too long (max 60 chars)' using errcode = '22023';
  end if;

  insert into places (user_id, name, lat, lng)
  values (v_uid, trim(p_name), p_lat, p_lng)
  on conflict (user_id, lower(name)) do update
    set lat = excluded.lat, lng = excluded.lng
  returning id into v_id;

  return v_id;
end;
$function$;

create function public.rename_place(p_place_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_name is null or trim(p_name) = '' then
    raise exception 'Place name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_name) > 60 then
    raise exception 'Place name too long (max 60 chars)' using errcode = '22023';
  end if;

  update places set name = trim(p_name)
  where id = p_place_id and user_id = v_uid;

  if not found then
    raise exception 'Place not found' using errcode = 'PGRST116';
  end if;
end;
$function$;

create function public.delete_place(p_place_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from places where id = p_place_id and user_id = v_uid;

  if not found then
    raise exception 'Place not found' using errcode = 'PGRST116';
  end if;
end;
$function$;

create function public.list_my_places()
returns setof places
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  return query select * from places where user_id = v_uid order by created_at;
end;
$function$;

create function public.report_place_transition(p_place_id uuid, p_entered boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  r      record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select name into v_name from places where id = p_place_id and user_id = v_uid;
  if v_name is null then
    raise exception 'Place not found' using errcode = 'PGRST116';
  end if;

  update places set currently_inside = p_entered where id = p_place_id;

  for r in
    select distinct family_id from family_members where user_id = v_uid
  loop
    insert into place_events (user_id, family_id, place_id, place_name, entered)
    values (v_uid, r.family_id, p_place_id, v_name, p_entered);
  end loop;
end;
$function$;

create trigger place_notification
  after insert on public.place_events
  for each row execute function trg_notify_edge_function(
    'https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-place-notification'
  );

revoke execute on function public.save_place(text, double precision, double precision) from public, anon;
grant  execute on function public.save_place(text, double precision, double precision) to authenticated, service_role;

revoke execute on function public.rename_place(uuid, text) from public, anon;
grant  execute on function public.rename_place(uuid, text) to authenticated, service_role;

revoke execute on function public.delete_place(uuid) from public, anon;
grant  execute on function public.delete_place(uuid) to authenticated, service_role;

revoke execute on function public.list_my_places() from public, anon;
grant  execute on function public.list_my_places() to authenticated, service_role;

revoke execute on function public.report_place_transition(uuid, boolean) from public, anon;
grant  execute on function public.report_place_transition(uuid, boolean) to authenticated, service_role;

-- Tell PostgREST about the new tables/functions straight away.
notify pgrst, 'reload schema';

commit;
