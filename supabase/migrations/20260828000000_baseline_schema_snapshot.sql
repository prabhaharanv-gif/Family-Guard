-- Baseline schema snapshot for family-guard-web (Famora)
-- Generated 2026-08-28 via SQL introspection (Supabase Management API) —
-- Docker was unavailable in the build environment, so this was assembled
-- from pg_catalog/information_schema queries rather than `supabase db pull`.
-- This captures the schema AS IT EXISTED at generation time. From this point
-- forward, every schema/RLS/function change should get its own migration file
-- (e.g. supabase/migrations/<timestamp>_description.sql) instead of being
-- applied ad hoc via the dashboard SQL editor with no record in the repo.

-- ══════════════════════════════════════════════════════════════
-- Extensions
-- ══════════════════════════════════════════════════════════════
create extension if not exists "pg_cron";
create extension if not exists "pg_net";
create extension if not exists "pg_stat_statements";
create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault";
create extension if not exists "uuid-ossp";

-- ══════════════════════════════════════════════════════════════
-- Tables
-- ══════════════════════════════════════════════════════════════
create table if not exists public.audit_log (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  action text not null,
  table_name text,
  record_id uuid,
  family_id uuid,
  ip_address text,
  created_at timestamp with time zone default now() not null,
  constraint audit_log_pkey PRIMARY KEY (id)
);

create table if not exists public.device_pings (
  id uuid default gen_random_uuid() not null,
  target_user_id uuid not null,
  family_id uuid not null,
  sent_by uuid not null,
  created_at timestamp with time zone default now(),
  constraint device_pings_pkey PRIMARY KEY (id)
);

create table if not exists public.device_tokens (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  family_id uuid not null,
  token text not null,
  platform text default 'android'::text,
  updated_at timestamp with time zone default now(),
  constraint device_tokens_pkey PRIMARY KEY (id)
);

create table if not exists public.families (
  id uuid default uuid_generate_v4() not null,
  name text not null,
  invite_code text default upper("substring"(md5((random())::text), 1, 6)) not null,
  created_by uuid,
  created_at timestamp with time zone default now(),
  constraint families_pkey PRIMARY KEY (id)
);

create table if not exists public.family_members (
  id uuid default uuid_generate_v4() not null,
  family_id uuid not null,
  user_id uuid not null,
  display_name text not null,
  avatar_color text default '#4F8EF7'::text,
  role text default 'member'::text,
  joined_at timestamp with time zone default now(),
  phone text,
  relationship text,
  bet_name text,
  is_online boolean default false,
  show_location boolean default true,
  show_last_seen boolean default true,
  last_active timestamp with time zone,
  avatar_url text,
  show_online boolean default true,
  privacy_agreed boolean default false,
  constraint family_members_pkey PRIMARY KEY (id)
);

create table if not exists public.geofences (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  created_by uuid not null,
  name text not null,
  lat numeric not null,
  lng numeric not null,
  radius_m integer default 200 not null,
  notify_on text default 'both'::text not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now(),
  constraint geofences_pkey PRIMARY KEY (id)
);

create table if not exists public.join_requests (
  id uuid default uuid_generate_v4() not null,
  family_id uuid not null,
  requester_id uuid not null,
  requester_name text not null,
  requester_phone text,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint join_requests_pkey PRIMARY KEY (id)
);

create table if not exists public.location_history (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  family_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamp with time zone default now(),
  constraint location_history_pkey PRIMARY KEY (id)
);

create table if not exists public.locations (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  family_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  battery_level integer,
  is_sharing boolean default true,
  updated_at timestamp with time zone default now(),
  is_charging boolean default false,
  speed numeric,
  constraint locations_pkey PRIMARY KEY (id)
);

create table if not exists public.member_nicknames (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  owner_user_id uuid not null,
  target_user_id uuid not null,
  nickname text not null,
  updated_at timestamp with time zone default now() not null,
  constraint member_nicknames_pkey PRIMARY KEY (id)
);

create table if not exists public.message_reads (
  message_id uuid not null,
  user_id uuid not null,
  family_id uuid not null,
  read_at timestamp with time zone default now() not null,
  constraint message_reads_pkey PRIMARY KEY (message_id, user_id)
);

create table if not exists public.messages (
  id uuid default uuid_generate_v4() not null,
  family_id uuid not null,
  user_id uuid not null,
  content text not null,
  created_at timestamp with time zone default now(),
  reply_to_id uuid,
  is_edited boolean default false not null,
  edited_at timestamp with time zone,
  updated_at timestamp with time zone default now(),
  constraint messages_pkey PRIMARY KEY (id)
);

create table if not exists public.sos_alerts (
  id uuid default uuid_generate_v4() not null,
  user_id uuid not null,
  family_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  message text default 'SOS! I need help!'::text,
  is_resolved boolean default false,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  constraint sos_alerts_pkey PRIMARY KEY (id)
);

-- Constraints (foreign keys, unique, check) — added after all tables exist
-- so cross-table foreign keys resolve regardless of table creation order.
alter table public.audit_log add constraint audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.device_pings add constraint device_pings_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.device_tokens add constraint device_tokens_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text])));
alter table public.device_tokens add constraint device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.device_tokens add constraint device_tokens_user_id_family_id_key UNIQUE (user_id, family_id);
alter table public.device_tokens add constraint device_tokens_unique_user_per_family UNIQUE (user_id, family_id);
alter table public.families add constraint families_name_length CHECK (((char_length(TRIM(BOTH FROM name)) > 0) AND (char_length(name) <= 100)));
alter table public.families add constraint families_invite_code_format CHECK ((invite_code ~ '^[A-Z0-9]{4,8}$'::text));
alter table public.families add constraint families_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.families add constraint families_invite_code_key UNIQUE (invite_code);
alter table public.family_members add constraint family_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])));
alter table public.family_members add constraint family_members_display_name_check CHECK (((char_length(TRIM(BOTH FROM display_name)) > 0) AND (char_length(display_name) <= 100)));
alter table public.family_members add constraint family_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.family_members add constraint family_members_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.family_members add constraint family_members_unique_user_per_family UNIQUE (user_id, family_id);
alter table public.geofences add constraint geofences_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.geofences add constraint geofences_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.join_requests add constraint join_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])));
alter table public.join_requests add constraint join_requests_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.join_requests add constraint join_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.location_history add constraint location_history_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.location_history add constraint location_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.locations add constraint locations_lng_range CHECK (((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision)));
alter table public.locations add constraint locations_lat_range CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision)));
alter table public.locations add constraint locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.locations add constraint locations_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.locations add constraint locations_unique_user_per_family UNIQUE (user_id, family_id);
alter table public.member_nicknames add constraint member_nicknames_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_nicknames add constraint member_nicknames_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.member_nicknames add constraint member_nicknames_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_nicknames add constraint member_nicknames_family_id_owner_user_id_target_user_id_key UNIQUE (family_id, owner_user_id, target_user_id);
alter table public.message_reads add constraint message_reads_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.message_reads add constraint message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.message_reads add constraint message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_content_length CHECK (((char_length(TRIM(BOTH FROM content)) > 0) AND (char_length(content) <= 2000)));
alter table public.messages add constraint messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL;
alter table public.sos_alerts add constraint sos_alerts_lng_range CHECK (((lng >= ('-180'::integer)::double precision) AND (lng <= (180)::double precision)));
alter table public.sos_alerts add constraint sos_alerts_lat_range CHECK (((lat >= ('-90'::integer)::double precision) AND (lat <= (90)::double precision)));
alter table public.sos_alerts add constraint sos_alerts_message_length CHECK ((char_length(message) <= 500));
alter table public.sos_alerts add constraint sos_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.sos_alerts add constraint sos_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);
alter table public.sos_alerts add constraint sos_alerts_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;

-- Indexes
CREATE UNIQUE INDEX join_requests_unique_pending ON public.join_requests USING btree (family_id, requester_id) WHERE (status = 'pending'::text);
CREATE INDEX idx_loc_history ON public.location_history USING btree (user_id, family_id, recorded_at DESC);
CREATE INDEX idx_message_reads_family ON public.message_reads USING btree (family_id);
CREATE INDEX idx_message_reads_message ON public.message_reads USING btree (message_id);
CREATE INDEX idx_messages_reply_to ON public.messages USING btree (reply_to_id);

-- ══════════════════════════════════════════════════════════════
-- Row Level Security
-- ══════════════════════════════════════════════════════════════
alter table public.audit_log enable row level security;
alter table public.device_pings enable row level security;
alter table public.device_tokens enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.geofences enable row level security;
alter table public.join_requests enable row level security;
alter table public.location_history enable row level security;
alter table public.locations enable row level security;
alter table public.member_nicknames enable row level security;
alter table public.message_reads enable row level security;
alter table public.messages enable row level security;
alter table public.sos_alerts enable row level security;

create policy "no client access to audit log" on public.audit_log
  as PERMISSIVE for ALL to public
  using (false);
create policy "service_role inserts audit log" on public.audit_log
  as PERMISSIVE for INSERT to service_role
  with check (true);
create policy "service_role reads audit log" on public.audit_log
  as PERMISSIVE for SELECT to service_role
  using (true);
create policy "family members can insert pings" on public.device_pings
  as PERMISSIVE for INSERT to public
  with check ((family_id IN ( SELECT family_members.family_id
   FROM family_members
  WHERE (family_members.user_id = auth.uid()))));
create policy "family members can read pings" on public.device_pings
  as PERMISSIVE for SELECT to public
  using ((family_id IN ( SELECT family_members.family_id
   FROM family_members
  WHERE (family_members.user_id = auth.uid()))));
create policy "no direct client insert on device_pings" on public.device_pings
  as PERMISSIVE for INSERT to authenticated
  with check (false);
create policy "target reads own pings" on public.device_pings
  as PERMISSIVE for SELECT to public
  using ((target_user_id = auth.uid()));
create policy "user deletes own sent pings" on public.device_pings
  as PERMISSIVE for DELETE to public
  using ((target_user_id = auth.uid()));
create policy "service_role_full_access_device_tokens" on public.device_tokens
  as PERMISSIVE for SELECT to service_role
  using (true);
create policy "service_role_read_device_tokens" on public.device_tokens
  as PERMISSIVE for SELECT to service_role
  using (true);
create policy "user deletes own device token" on public.device_tokens
  as PERMISSIVE for DELETE to public
  using ((user_id = auth.uid()));
create policy "user reads own device token" on public.device_tokens
  as PERMISSIVE for SELECT to public
  using ((user_id = auth.uid()));
create policy "authenticated users can create a family" on public.families
  as PERMISSIVE for INSERT to authenticated
  with check ((auth.uid() = created_by));
create policy "members can read own family" on public.families
  as PERMISSIVE for SELECT to public
  using (is_family_member(id));
create policy "no client delete on families" on public.families
  as PERMISSIVE for DELETE to public
  using (false);
create policy "no direct client update on families" on public.families
  as PERMISSIVE for UPDATE to public
  using (false);
create policy "Members can update own last_active" on public.family_members
  as PERMISSIVE for UPDATE to public
  using ((auth.uid() = user_id));
create policy "family owner can delete members" on public.family_members
  as PERMISSIVE for DELETE to public
  using ((family_id IN ( SELECT families.id
   FROM families
  WHERE (families.created_by = auth.uid()))));
create policy "members can read own family members" on public.family_members
  as PERMISSIVE for SELECT to public
  using (is_family_member(family_id));
create policy "no direct client update on family_members" on public.family_members
  as PERMISSIVE for UPDATE to public
  using (false);
create policy "service_role_read_family_members" on public.family_members
  as PERMISSIVE for SELECT to service_role
  using (true);
create policy "service_role_update_family_members" on public.family_members
  as PERMISSIVE for UPDATE to service_role
  using (true)
  with check (true);
create policy "user can leave or admin can remove" on public.family_members
  as PERMISSIVE for DELETE to public
  using (((user_id = auth.uid()) OR is_family_admin(family_id)));
create policy "family manage geofences" on public.geofences
  as PERMISSIVE for ALL to public
  using ((EXISTS ( SELECT 1
   FROM family_members
  WHERE ((family_members.family_id = geofences.family_id) AND (family_members.user_id = auth.uid())))));
create policy "admin updates join request status" on public.join_requests
  as PERMISSIVE for UPDATE to public
  using (is_family_admin(family_id))
  with check (is_family_admin(family_id));
create policy "no direct client insert on join_requests" on public.join_requests
  as PERMISSIVE for INSERT to authenticated
  with check (false);
create policy "requester or admin can read join requests" on public.join_requests
  as PERMISSIVE for SELECT to public
  using (((requester_id = auth.uid()) OR is_family_admin(family_id)));
create policy "requester or admin deletes join request" on public.join_requests
  as PERMISSIVE for DELETE to public
  using (((requester_id = auth.uid()) OR is_family_admin(family_id)));
create policy "Family can view location history" on public.location_history
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members fm
  WHERE ((fm.family_id = location_history.family_id) AND (fm.user_id = auth.uid())))));
create policy "Users can insert own location history" on public.location_history
  as PERMISSIVE for INSERT to public
  with check ((auth.uid() = user_id));
create policy "family read history" on public.location_history
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members
  WHERE ((family_members.family_id = location_history.family_id) AND (family_members.user_id = auth.uid())))));
create policy "own history insert" on public.location_history
  as PERMISSIVE for INSERT to public
  with check ((user_id = auth.uid()));
create policy "Family members can view locations" on public.locations
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members fm
  WHERE ((fm.family_id = locations.family_id) AND (fm.user_id = auth.uid())))));
create policy "Users can update own location" on public.locations
  as PERMISSIVE for UPDATE to public
  using ((auth.uid() = user_id));
create policy "Users can upsert own location" on public.locations
  as PERMISSIVE for INSERT to public
  with check ((auth.uid() = user_id));
create policy "family members can read locations" on public.locations
  as PERMISSIVE for SELECT to public
  using ((family_id IN ( SELECT family_members.family_id
   FROM family_members
  WHERE (family_members.user_id = auth.uid()))));
create policy "locations insert own" on public.locations
  as PERMISSIVE for INSERT to public
  with check ((user_id = auth.uid()));
create policy "locations read same family" on public.locations
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members me
  WHERE ((me.user_id = auth.uid()) AND (me.family_id = locations.family_id)))));
create policy "locations update own" on public.locations
  as PERMISSIVE for UPDATE to public
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy "members see non-zero sharing locations in family" on public.locations
  as PERMISSIVE for SELECT to public
  using (((is_sharing = true) AND is_family_member(family_id) AND ((lat <> (0)::double precision) OR (lng <> (0)::double precision))));
create policy "service_role_read_locations" on public.locations
  as PERMISSIVE for SELECT to service_role
  using (true);
create policy "user can insert own location" on public.locations
  as PERMISSIVE for INSERT to public
  with check ((user_id = auth.uid()));
create policy "user can update own location" on public.locations
  as PERMISSIVE for UPDATE to public
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
create policy "delete own nicknames" on public.member_nicknames
  as PERMISSIVE for DELETE to public
  using ((owner_user_id = auth.uid()));
create policy "insert own nicknames" on public.member_nicknames
  as PERMISSIVE for INSERT to public
  with check ((owner_user_id = auth.uid()));
create policy "read own nicknames" on public.member_nicknames
  as PERMISSIVE for SELECT to public
  using ((owner_user_id = auth.uid()));
create policy "update own nicknames" on public.member_nicknames
  as PERMISSIVE for UPDATE to public
  using ((owner_user_id = auth.uid()));
create policy "reads insert own" on public.message_reads
  as PERMISSIVE for INSERT to public
  with check ((user_id = auth.uid()));
create policy "reads read same family" on public.message_reads
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members me
  WHERE ((me.user_id = auth.uid()) AND (me.family_id = message_reads.family_id)))));
create policy "Family members can delete messages" on public.messages
  as PERMISSIVE for DELETE to public
  using ((EXISTS ( SELECT 1
   FROM family_members
  WHERE ((family_members.family_id = messages.family_id) AND (family_members.user_id = auth.uid())))));
create policy "member deletes own or admin clears family" on public.messages
  as PERMISSIVE for DELETE to public
  using (((user_id = auth.uid()) OR is_family_admin(family_id)));
create policy "member sends message as self only" on public.messages
  as PERMISSIVE for INSERT to authenticated
  with check (((user_id = auth.uid()) AND is_family_member(family_id)));
create policy "members read own family messages" on public.messages
  as PERMISSIVE for SELECT to public
  using (is_family_member(family_id));
create policy "no message update via client" on public.messages
  as PERMISSIVE for UPDATE to public
  using (false);
create policy "Family admin can resolve SOS" on public.sos_alerts
  as PERMISSIVE for UPDATE to public
  using ((EXISTS ( SELECT 1
   FROM family_members fm
  WHERE ((fm.family_id = sos_alerts.family_id) AND (fm.user_id = auth.uid())))));
create policy "Family can view SOS alerts" on public.sos_alerts
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members fm
  WHERE ((fm.family_id = sos_alerts.family_id) AND (fm.user_id = auth.uid())))));
create policy "Family members can read sos alerts" on public.sos_alerts
  as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1
   FROM family_members
  WHERE ((family_members.family_id = sos_alerts.family_id) AND (family_members.user_id = auth.uid())))));
create policy "Users can create SOS alerts" on public.sos_alerts
  as PERMISSIVE for INSERT to public
  with check ((auth.uid() = user_id));
create policy "members read family sos alerts" on public.sos_alerts
  as PERMISSIVE for SELECT to public
  using (is_family_member(family_id));
create policy "no direct client delete on sos_alerts" on public.sos_alerts
  as PERMISSIVE for DELETE to public
  using (false);
create policy "no direct client insert on sos_alerts" on public.sos_alerts
  as PERMISSIVE for INSERT to authenticated
  with check (false);
create policy "no direct client update on sos_alerts" on public.sos_alerts
  as PERMISSIVE for UPDATE to public
  using (false);
create policy "service_role_all_sos_alerts" on public.sos_alerts
  as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

-- ══════════════════════════════════════════════════════════════
-- Functions
-- ══════════════════════════════════════════════════════════════
-- NOTE: trg_notify_edge_function() below depends on a Vault secret named
-- 'service_role_key' that is NOT created by this file (secrets must never
-- live in a git-committed migration). On a fresh environment, run this
-- FIRST, with the real key substituted in via the Supabase dashboard:
--
--   select vault.create_secret('<service_role_key>', 'service_role_key',
--     'Used by DB triggers to call notification Edge Functions');

CREATE OR REPLACE FUNCTION public.accept_join_request(request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_req
  from join_requests
  where id = request_id and status = 'pending';

  if not found then
    raise exception 'Join request not found or already processed' using errcode = 'P0002';
  end if;

  -- Verify admin of the target family
  if not is_family_admin(v_req.family_id) then
    raise exception 'Only family admins can accept join requests' using errcode = 'PGRST301';
  end if;

  -- Insert member atomically (duplicate is silently ignored)
  insert into family_members (family_id, user_id, display_name, role)
  values (
    v_req.family_id,
    v_req.requester_id,
    coalesce(nullif(trim(v_req.requester_name), ''), 'Family Member'),
    'member'
  )
  on conflict (user_id, family_id) do nothing;

  update join_requests
  set status = 'accepted', updated_at = now()
  where id = request_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.add_family_contact(p_family_id uuid, p_display_name text, p_phone text DEFAULT NULL::text, p_relationship text DEFAULT NULL::text, p_bet_name text DEFAULT NULL::text, p_avatar_color text DEFAULT '#951345'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_contact_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  -- Validate inputs
  if p_display_name is null or trim(p_display_name) = '' then
    raise exception 'Display name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_display_name) > 100 then
    raise exception 'Display name too long (max 100 chars)' using errcode = '22023';
  end if;
  if p_relationship is not null and char_length(p_relationship) > 50 then
    raise exception 'Relationship too long (max 50 chars)' using errcode = '22023';
  end if;

  -- Generate UUID server-side — client cannot control this
  v_contact_id := gen_random_uuid();

  insert into family_members (
    family_id, user_id, display_name, phone,
    relationship, bet_name, avatar_color, role
  ) values (
    p_family_id, v_contact_id, trim(p_display_name), p_phone,
    p_relationship, p_bet_name, coalesce(p_avatar_color, '#951345'), 'member'
  );

  return v_contact_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.change_member_role(p_family_id uuid, p_user_id uuid, p_new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_new_role not in ('admin', 'member') then
    raise exception 'Invalid role. Must be admin or member' using errcode = '22023';
  end if;

  if not is_family_admin(p_family_id) then
    raise exception 'Only admins can change member roles' using errcode = 'PGRST301';
  end if;

  -- Cannot demote the family creator
  if p_new_role = 'member' and exists (
    select 1 from families where id = p_family_id and created_by = p_user_id
  ) then
    raise exception 'Cannot demote the family owner' using errcode = '22023';
  end if;

  update family_members
  set role = p_new_role
  where user_id   = p_user_id
    and family_id = p_family_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.clear_family_messages(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_id = p_family_id AND user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM messages WHERE family_id = p_family_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.clear_sos_history(p_family_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  if not is_family_admin(p_family_id) then
    raise exception 'Only admins can clear SOS history' using errcode = 'PGRST301';
  end if;

  delete from sos_alerts
  where family_id  = p_family_id
    and is_resolved = true;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$

CREATE OR REPLACE FUNCTION public.create_family_with_membership(p_family_name text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_family families%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Validate inputs
  if p_family_name is null or trim(p_family_name) = '' then
    raise exception 'Family name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_family_name) > 100 then
    raise exception 'Family name too long (max 100 chars)' using errcode = '22023';
  end if;
  if p_display_name is null or trim(p_display_name) = '' then
    raise exception 'Display name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_display_name) > 100 then
    raise exception 'Display name too long (max 100 chars)' using errcode = '22023';
  end if;

  -- Create family (created_by forced to auth.uid())
  insert into families (name, created_by)
  values (trim(p_family_name), v_uid)
  returning * into v_family;

  -- Create admin membership atomically in same transaction
  insert into family_members (family_id, user_id, display_name, role)
  values (v_family.id, v_uid, trim(p_display_name), 'admin');

  return jsonb_build_object(
    'id',          v_family.id,
    'name',        v_family.name,
    'invite_code', v_family.invite_code,
    'created_by',  v_family.created_by
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.delete_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only the original sender can delete
  IF NOT EXISTS (
    SELECT 1 FROM messages
    WHERE id = p_message_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not your message';
  END IF;

  DELETE FROM messages WHERE id = p_message_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_family     RECORD;
  v_other_admin uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── 1. Handle families this user created ──────────────────────────────────
  FOR v_family IN
    SELECT id FROM families WHERE created_by = v_uid
  LOOP
    -- Check if another member exists who can take over
    SELECT user_id INTO v_other_admin
      FROM family_members
      WHERE family_id = v_family.id
        AND user_id != v_uid
      LIMIT 1;

    IF v_other_admin IS NOT NULL THEN
      -- Transfer ownership to the first other member
      UPDATE families SET created_by = v_other_admin WHERE id = v_family.id;
      UPDATE family_members SET role = 'admin' WHERE family_id = v_family.id AND user_id = v_other_admin;
    ELSE
      -- No other members — delete the entire family and all its data
      DELETE FROM sos_alerts      WHERE family_id = v_family.id;
      DELETE FROM messages        WHERE family_id = v_family.id;
      DELETE FROM message_reads   WHERE family_id = v_family.id;
      DELETE FROM locations       WHERE family_id = v_family.id;
      DELETE FROM device_tokens   WHERE family_id = v_family.id;
      DELETE FROM device_pings    WHERE family_id = v_family.id;
      DELETE FROM join_requests   WHERE family_id = v_family.id;
      DELETE FROM member_nicknames WHERE family_id = v_family.id;
      DELETE FROM family_members  WHERE family_id = v_family.id;
      DELETE FROM families        WHERE id = v_family.id;
    END IF;
  END LOOP;

  -- ── 2. Clean up this user's data across all families they joined ──────────
  DELETE FROM sos_alerts       WHERE user_id = v_uid;
  DELETE FROM messages         WHERE user_id = v_uid;
  DELETE FROM message_reads    WHERE user_id = v_uid;
  DELETE FROM locations        WHERE user_id = v_uid;
  DELETE FROM device_tokens    WHERE user_id = v_uid;
  DELETE FROM device_pings     WHERE target_user_id = v_uid OR sent_by = v_uid;
  DELETE FROM join_requests    WHERE requester_id = v_uid;
  DELETE FROM member_nicknames WHERE owner_user_id = v_uid OR target_user_id = v_uid;
  DELETE FROM family_members   WHERE user_id = v_uid;

  -- ── 3. Delete the auth account ────────────────────────────────────────────
  -- This requires SECURITY DEFINER + service_role level access to auth schema
  DELETE FROM auth.users WHERE id = v_uid;

END;
$function$

CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_new_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only the original sender can edit
  IF NOT EXISTS (
    SELECT 1 FROM messages
    WHERE id = p_message_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not your message';
  END IF;

  UPDATE messages
  SET content = p_new_content, is_edited = TRUE, updated_at = now()
  WHERE id = p_message_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.is_family_admin(fid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from family_members
    where family_id = fid
      and user_id   = auth.uid()
      and role      = 'admin'
  )
$function$

CREATE OR REPLACE FUNCTION public.is_family_member(fid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from family_members
    where family_id = fid
      and user_id   = auth.uid()
  )
$function$

CREATE OR REPLACE FUNCTION public.log_audit_event(p_action text, p_table_name text DEFAULT NULL::text, p_record_id uuid DEFAULT NULL::uuid, p_family_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into audit_log (user_id, action, table_name, record_id, family_id)
  values (auth.uid(), p_action, p_table_name, p_record_id, p_family_id);
exception when others then
  -- Never let audit logging block the main operation
  null;
end;
$function$

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Must be a member of the family
  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this family';
  end if;

  insert into public.message_reads (message_id, user_id, family_id, read_at)
  select m.id, auth.uid(), p_family_id, now()
  from public.messages m
  where m.family_id = p_family_id
    and m.user_id <> auth.uid()                    -- don't mark my own messages
  on conflict (message_id, user_id) do nothing;    -- skip ones I already read
end;
$function$

CREATE OR REPLACE FUNCTION public.reject_join_request(request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_req
  from join_requests
  where id = request_id and status = 'pending';

  if not found then
    raise exception 'Join request not found or already processed' using errcode = 'P0002';
  end if;

  if not is_family_admin(v_req.family_id) then
    raise exception 'Only family admins can reject join requests' using errcode = 'PGRST301';
  end if;

  update join_requests
  set status = 'rejected', updated_at = now()
  where id = request_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.remove_family_member(p_family_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Cannot remove yourself with this function — use leave_family
  if p_user_id = v_uid then
    raise exception 'Use leave_family to remove yourself' using errcode = '22023';
  end if;

  -- Must be admin
  if not is_family_admin(p_family_id) then
    raise exception 'Only admins can remove members' using errcode = 'PGRST301';
  end if;

  -- Cannot remove the family creator/only admin
  if exists (
    select 1 from families where id = p_family_id and created_by = p_user_id
  ) then
    raise exception 'Cannot remove the family owner' using errcode = '22023';
  end if;

  delete from family_members
  where user_id   = p_user_id
    and family_id = p_family_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.reset_password_verified(p_new_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_phone text := auth.jwt()->>'phone';
  v_email text;
  v_uid   uuid;
begin
  if v_phone is null or v_phone = '' then
    raise exception 'Phone verification required';
  end if;
  if length(p_new_password) < 6 then
    raise exception 'Password too short';
  end if;

  v_email := regexp_replace(v_phone, '^\+', '') || '@familyguard.app';

  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception 'No account found for this verified phone number';
  end if;

  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf')) where id = v_uid;
end;
$function$

CREATE OR REPLACE FUNCTION public.resolve_sos(p_sos_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_alert sos_alerts%rowtype;
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

  -- Caller must be a member of the same family as the SOS
  if not is_family_member(v_alert.family_id) then
    raise exception 'Not authorized to resolve this SOS' using errcode = 'PGRST301';
  end if;

  -- Only update the three allowed fields — identity fields untouched
  update sos_alerts
  set
    is_resolved = true,
    resolved_by = v_uid,
    resolved_at = now()
  where id = p_sos_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.send_device_ping(p_family_id uuid, p_target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Sender must be a family member
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  -- Target must be in the SAME family
  if not exists (
    select 1 from family_members
    where user_id   = p_target_user_id
      and family_id = p_family_id
  ) then
    raise exception 'Target user is not in this family' using errcode = 'PGRST116';
  end if;

  -- Cannot ping yourself
  if p_target_user_id = v_uid then
    raise exception 'Cannot ping yourself' using errcode = '22023';
  end if;

  -- sent_by forced to auth.uid() — never trusted from client
  insert into device_pings (target_user_id, family_id, sent_by)
  values (p_target_user_id, p_family_id, v_uid);
end;
$function$

CREATE OR REPLACE FUNCTION public.send_message(p_family_id uuid, p_content text, p_reply_to_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Verify caller is a member of this family
  IF NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_id = p_family_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this family';
  END IF;

  INSERT INTO messages (family_id, user_id, content, reply_to_id)
  VALUES (p_family_id, auth.uid(), p_content, p_reply_to_id);
END;
$function$

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
  -- Must be authenticated
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Validate coordinates
  if p_lat  is null or p_lat  < -90  or p_lat  > 90  then
    raise exception 'Invalid latitude: %',  p_lat  using errcode = '22023';
  end if;
  if p_lng  is null or p_lng  < -180 or p_lng  > 180 then
    raise exception 'Invalid longitude: %', p_lng  using errcode = '22023';
  end if;

  -- Validate message
  if p_message is null or trim(p_message) = '' then
    raise exception 'SOS message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_message) > 500 then
    raise exception 'SOS message too long (max 500 chars)' using errcode = '22023';
  end if;

  -- Verify family membership (uses auth.uid() internally)
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  insert into sos_alerts (user_id, family_id, lat, lng, message)
  values (v_uid, p_family_id, p_lat, p_lng, p_message)
  returning id into v_id;

  return v_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.set_location_sharing(p_family_id uuid, p_is_sharing boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE locations
  SET is_sharing  = p_is_sharing,
      updated_at  = now()
  WHERE user_id   = auth.uid()
    AND family_id = p_family_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.set_member_nickname(p_family_id uuid, p_target_user_id uuid, p_nickname text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Caller must belong to this family
  if not exists (
    select 1 from public.family_members
    where family_id = p_family_id and user_id = auth.uid()
  ) then
    raise exception 'Not a member of this family';
  end if;

  if p_nickname is null or btrim(p_nickname) = '' then
    delete from public.member_nicknames
    where family_id = p_family_id
      and owner_user_id = auth.uid()
      and target_user_id = p_target_user_id;
    return;
  end if;

  insert into public.member_nicknames (family_id, owner_user_id, target_user_id, nickname, updated_at)
  values (p_family_id, auth.uid(), p_target_user_id, btrim(p_nickname), now())
  on conflict (family_id, owner_user_id, target_user_id)
  do update set nickname = excluded.nickname, updated_at = now();
end;
$function$

CREATE OR REPLACE FUNCTION public.submit_join_request(p_invite_code text, p_requester_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_family families%rowtype;
  v_req_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Validate inputs
  if p_invite_code is null or trim(p_invite_code) = '' then
    raise exception 'Invite code is required' using errcode = '22023';
  end if;
  if p_requester_name is null or trim(p_requester_name) = '' then
    raise exception 'Your name is required' using errcode = '22023';
  end if;
  if char_length(p_requester_name) > 100 then
    raise exception 'Name too long (max 100 chars)' using errcode = '22023';
  end if;

  -- Normalize invite code
  p_invite_code := upper(trim(p_invite_code));

  -- Look up family by invite code
  select * into v_family
  from families
  where invite_code = p_invite_code;

  if not found then
    raise exception 'Invalid invite code' using errcode = 'P0002';
  end if;

  -- Not already a member
  if exists (
    select 1 from family_members
    where user_id = v_uid and family_id = v_family.id
  ) then
    raise exception 'You are already a member of this family' using errcode = '22023';
  end if;

  -- No duplicate pending request (UNIQUE INDEX handles this but give a clear message)
  if exists (
    select 1 from join_requests
    where requester_id = v_uid
      and family_id    = v_family.id
      and status       = 'pending'
  ) then
    raise exception 'You already have a pending request to join this family' using errcode = '22023';
  end if;

  -- requester_id forced to auth.uid()
  insert into join_requests (family_id, requester_id, requester_name)
  values (v_family.id, v_uid, trim(p_requester_name))
  returning id into v_req_id;

  return v_req_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.sync_avatar_all_families(p_avatar_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.family_members
     set avatar_url = p_avatar_url
   where user_id = auth.uid();
end;
$function$

CREATE OR REPLACE FUNCTION public.sync_location_sharing_all_families(p_is_sharing boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Update existing rows
  update public.locations
     set is_sharing = p_is_sharing
   where user_id = auth.uid();

  -- Insert a row for any family the user is in but has no locations row yet
  insert into public.locations (user_id, family_id, lat, lng, is_sharing, updated_at)
  select auth.uid(), fm.family_id, 0, 0, p_is_sharing, now()
    from public.family_members fm
   where fm.user_id = auth.uid()
     and not exists (
       select 1 from public.locations l
        where l.user_id = auth.uid()
          and l.family_id = fm.family_id
     );
end;
$function$

CREATE OR REPLACE FUNCTION public.sync_privacy_all_families(p_show_location boolean, p_show_online boolean, p_show_last_seen boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.family_members
     set show_location  = p_show_location,
         show_online    = p_show_online,
         show_last_seen = p_show_last_seen
   where user_id = auth.uid();
end;
$function$

CREATE OR REPLACE FUNCTION public.sync_profile_all_families(p_display_name text, p_phone text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.family_members
     set display_name = p_display_name,
         phone        = p_phone
   where user_id = auth.uid();
end;
$function$

CREATE OR REPLACE FUNCTION public.trg_audit_member_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into audit_log (user_id, action, table_name, record_id, family_id)
  values (auth.uid(), 'MEMBER_REMOVED', 'family_members', old.id, old.family_id);
  return old;
end;
$function$

CREATE OR REPLACE FUNCTION public.trg_audit_sos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into audit_log (user_id, action, table_name, record_id, family_id)
  values (new.user_id, 'SOS_CREATED', 'sos_alerts', new.id, new.family_id);
  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.trg_notify_edge_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'net'
AS $function$
declare
  v_key text;
  v_url text := TG_ARGV[0];
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    raise warning 'service_role_key not found in vault — skipping notification call';
    return coalesce(new, old);
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object('Content-type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 5000
  );
  return coalesce(new, old);
end;
$function$

CREATE OR REPLACE FUNCTION public.update_family_name(p_family_id uuid, p_new_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if not is_family_admin(p_family_id) then
    raise exception 'Only admins can rename the family' using errcode = 'PGRST301';
  end if;

  if p_new_name is null or trim(p_new_name) = '' then
    raise exception 'Family name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_new_name) > 100 then
    raise exception 'Family name too long (max 100 chars)' using errcode = '22023';
  end if;

  -- Only update the name — created_by, invite_code, id are immutable
  update families
  set name = trim(p_new_name)
  where id = p_family_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.update_member_avatar(p_family_id uuid, p_avatar_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.family_members
  set avatar_url = p_avatar_url
  where family_id = p_family_id
    and user_id = auth.uid();

  if not found then
    raise exception 'No family_members row for this user/family';
  end if;
end;
$function$

CREATE OR REPLACE FUNCTION public.update_member_heartbeat(p_family_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not is_family_member(p_family_id) then return; end if;

  update family_members
  set last_active = now()
  where user_id   = v_uid
    and family_id = p_family_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.update_member_privacy(p_family_id uuid, p_show_location boolean DEFAULT NULL::boolean, p_show_last_seen boolean DEFAULT NULL::boolean, p_show_online boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  update family_members
  set
    show_location  = coalesce(p_show_location,  show_location),
    show_last_seen = coalesce(p_show_last_seen, show_last_seen),
    show_online    = coalesce(p_show_online,    show_online)
  where user_id   = v_uid
    and family_id = p_family_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.update_member_profile(p_family_id uuid, p_display_name text, p_phone text DEFAULT NULL::text, p_relationship text DEFAULT NULL::text, p_avatar_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;
  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;
  if p_display_name is null or trim(p_display_name) = '' then
    raise exception 'Display name cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_display_name) > 100 then
    raise exception 'Display name too long (max 100 chars)' using errcode = '22023';
  end if;

  update family_members
  set
    display_name = trim(p_display_name),
    phone        = p_phone,
    relationship = p_relationship,
    avatar_url   = coalesce(p_avatar_url, avatar_url)
  where user_id   = v_uid
    and family_id = p_family_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.upsert_device_token(p_family_id uuid, p_token text, p_platform text DEFAULT 'android'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Validate token
  if p_token is null or trim(p_token) = '' then
    raise exception 'Device token cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_token) > 4096 then
    raise exception 'Device token too long' using errcode = '22023';
  end if;

  -- Validate platform
  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'Invalid platform: %. Must be android, ios, or web', p_platform using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  insert into device_tokens (user_id, family_id, token, platform, updated_at)
  values (v_uid, p_family_id, p_token, p_platform, now())
  on conflict (user_id, family_id)
  do update set
    token      = excluded.token,
    platform   = excluded.platform,
    updated_at = excluded.updated_at;
end;
$function$

CREATE OR REPLACE FUNCTION public.upsert_location(p_family_id uuid, p_lat double precision, p_lng double precision, p_is_sharing boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  -- Validate coordinates (allow 0,0 as "no location" placeholder)
  if p_lat is null or p_lat < -90  or p_lat > 90  then
    raise exception 'Invalid latitude: %',  p_lat  using errcode = '22023';
  end if;
  if p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Invalid longitude: %', p_lng  using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  insert into locations (user_id, family_id, lat, lng, is_sharing, updated_at)
  values (v_uid, p_family_id, p_lat, p_lng, coalesce(p_is_sharing, true), now())
  on conflict (user_id, family_id)
  do update set
    lat        = excluded.lat,
    lng        = excluded.lng,
    is_sharing = excluded.is_sharing,
    updated_at = excluded.updated_at;
end;
$function$

CREATE OR REPLACE FUNCTION public.upsert_location_with_battery(p_family_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric DEFAULT 0, p_speed numeric DEFAULT NULL::numeric, p_battery integer DEFAULT NULL::integer, p_is_charging boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO locations (user_id,family_id,lat,lng,accuracy,speed,battery_level,is_charging,is_sharing,updated_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,p_accuracy,p_speed,p_battery,p_is_charging,true,v_now)
  ON CONFLICT (user_id,family_id) DO UPDATE SET
    lat=EXCLUDED.lat,lng=EXCLUDED.lng,accuracy=EXCLUDED.accuracy,
    speed=EXCLUDED.speed,battery_level=EXCLUDED.battery_level,
    is_charging=EXCLUDED.is_charging,is_sharing=true,updated_at=v_now;
  INSERT INTO location_history (user_id,family_id,lat,lng,recorded_at)
  VALUES (v_uid,p_family_id,p_lat,p_lng,v_now);
  UPDATE family_members SET last_active=v_now WHERE user_id=v_uid AND family_id=p_family_id;
END;
$function$

-- ══════════════════════════════════════════════════════════════
-- Triggers
-- ══════════════════════════════════════════════════════════════
create trigger audit_member_removed
  AFTER DELETE on public.family_members
  for each row EXECUTE FUNCTION trg_audit_member_removal();
create trigger message_notification
  AFTER INSERT on public.messages
  for each row EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-message-notification');
create trigger audit_sos_created
  AFTER INSERT on public.sos_alerts
  for each row EXECUTE FUNCTION trg_audit_sos();
create trigger sos_notification
  AFTER INSERT on public.sos_alerts
  for each row EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-sos-notification');

-- ══════════════════════════════════════════════════════════════
-- Storage buckets & policies
-- ══════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, '["image/jpeg", "image/png", "image/webp", "image/gif"]'::jsonb)
on conflict (id) do nothing;

create policy "Public avatar access" on storage.objects
  as PERMISSIVE for SELECT to public
  using ((bucket_id = 'avatars'::text));
create policy "Users can update own avatar" on storage.objects
  as PERMISSIVE for UPDATE to authenticated
  using (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
create policy "Users can upload own avatar" on storage.objects
  as PERMISSIVE for INSERT to authenticated
  with check (((bucket_id = 'avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));
create policy "avatars public read" on storage.objects
  as PERMISSIVE for SELECT to public
  using ((bucket_id = 'avatars'::text));
create policy "avatars user update" on storage.objects
  as PERMISSIVE for UPDATE to public
  using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "avatars user upload" on storage.objects
  as PERMISSIVE for INSERT to public
  with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

-- ══════════════════════════════════════════════════════════════
-- Scheduled data-retention jobs (pg_cron)
-- ══════════════════════════════════════════════════════════════
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
