-- ===========================================================================
-- Phone lost mode
-- ===========================================================================
--
-- A family admin (or the owner) marks a member phone as lost. That phone then
-- reports its position every few seconds, rings loudly every 2 minutes, and
-- shows a message on the lock screen, until it is switched off or 12 hours pass.
--
-- Opt-in by the PHONE OWNER: user_alert_prefs.allow_lost_mode is false until
-- they switch it on in Profile -> Safety. Without it nobody can start lost mode
-- on that phone.
--
-- One row per lost phone (a phone belongs to a person, not to a family), created
-- and removed only through the two functions below. Family members can read it,
-- so every card can show a Lost label.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

alter table public.user_alert_prefs
  add column if not exists allow_lost_mode boolean not null default false;

create table if not exists public.lost_phone (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  started_by  uuid not null references auth.users(id) on delete cascade,
  starter_name text,
  message     text,
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '12 hours')
);

alter table public.lost_phone enable row level security;

-- Anyone who shares a family with the lost phone owner can see that it is lost.
drop policy if exists "family members read lost phone" on public.lost_phone;
create policy "family members read lost phone" on public.lost_phone
  as PERMISSIVE for SELECT to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.family_members a
        join public.family_members b on b.family_id = a.family_id
       where a.user_id = lost_phone.user_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "service_role_all_lost_phone" on public.lost_phone;
create policy "service_role_all_lost_phone" on public.lost_phone
  as PERMISSIVE for ALL to service_role using (true) with check (true);

-- Is the caller allowed to act on this phone? The owner, or an admin of a
-- family the two share.
create or replace function public._can_manage_lost_phone(p_target uuid)
 returns boolean
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() = p_target
      or exists (
        select 1 from public.family_members me
          join public.family_members them on them.family_id = me.family_id
         where me.user_id = auth.uid() and me.role = 'admin' and them.user_id = p_target
      );
$function$;

revoke execute on function public._can_manage_lost_phone(uuid) from public, anon, authenticated;

create or replace function public.start_lost_phone(p_target uuid, p_message text default null)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_allowed boolean;
  v_name    text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public._can_manage_lost_phone(p_target) then
    raise exception 'only the phone owner or a family admin can do this' using errcode = '42501';
  end if;

  select allow_lost_mode into v_allowed from public.user_alert_prefs where user_id = p_target;
  if v_allowed is not true then
    raise exception 'this member has not allowed phone lost mode' using errcode = 'P0001';
  end if;

  select display_name into v_name from public.family_members
   where user_id = auth.uid() order by created_at limit 1;

  insert into public.lost_phone (user_id, started_by, starter_name, message, started_at, expires_at)
  values (p_target, auth.uid(), v_name, left(nullif(trim(coalesce(p_message, '')), ''), 140),
          now(), now() + interval '12 hours')
  on conflict (user_id) do update
    set started_by = excluded.started_by, starter_name = excluded.starter_name,
        message = excluded.message, started_at = excluded.started_at, expires_at = excluded.expires_at;
end;
$function$;

create or replace function public.stop_lost_phone(p_target uuid)
 returns void
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public._can_manage_lost_phone(p_target) then
    raise exception 'only the phone owner or a family admin can do this' using errcode = '42501';
  end if;
  delete from public.lost_phone where user_id = p_target;
end;
$function$;

revoke execute on function public.start_lost_phone(uuid, text) from public, anon;
revoke execute on function public.stop_lost_phone(uuid) from public, anon;
grant  execute on function public.start_lost_phone(uuid, text) to authenticated, service_role;
grant  execute on function public.stop_lost_phone(uuid) to authenticated, service_role;

-- Tell the lost phone: on start or change, and on stop (including expiry).
drop trigger if exists lost_phone_notification on public.lost_phone;
create trigger lost_phone_notification
  after insert or update or delete on public.lost_phone
  for each row execute function trg_notify_edge_function(
    'https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-lost-phone-notification'
  );

-- 12 hours is the limit even if the phone never hears about it: remove expired
-- rows every 5 minutes, which also tells the phone to stop.
select cron.schedule('expire_lost_phone', '*/5 * * * *',
  'delete from public.lost_phone where expires_at < now()');

-- Cards update live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lost_phone'
  ) then
    alter publication supabase_realtime add table public.lost_phone;
  end if;
end $$;

notify pgrst, 'reload schema';
