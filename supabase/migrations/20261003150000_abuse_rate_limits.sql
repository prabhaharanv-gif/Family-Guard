-- ===========================================================================
-- Rate limits against abuse
-- ===========================================================================
--
-- Until now only device pings and SOS media had a rate limit. Anyone approved
-- into a family could send SOS alerts, chat messages and calls as fast as a
-- script can post them, and any signed-in account could spend third-party API
-- quota (weather, routes) without limit.
--
-- Two kinds of limit, both enforced in the database so a modified app cannot
-- skip them:
--
--   1. BEFORE INSERT triggers on sos_alerts, messages, direct_messages and calls.
--      A trigger rather than a rewrite of send_sos, send_message and the other
--      functions, so every present and future writer is covered and none of
--      those functions has to be copied here.
--   2. consume_api_quota(), a counter the paid-lookup edge functions call.
--
-- The SOS limits are deliberately loose: a real emergency must never be
-- refused, so a second SOS is only blocked within 10 seconds of the last one
-- (one tap, one SOS), and ten separate SOS events in ten minutes is the cap.
-- One SOS sent to several families is one event: those rows share a group id.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

-- ── 1. Write limits ─────────────────────────────────────────────────────────

create or replace function public.limit_sos_alerts()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_group  uuid := coalesce(new.sos_group_id, new.id);
  v_recent integer;
  v_burst  integer;
begin
  select count(distinct coalesce(a.sos_group_id, a.id)) filter (where a.created_at > now() - interval '10 seconds'),
         count(distinct coalesce(a.sos_group_id, a.id))
    into v_recent, v_burst
    from public.sos_alerts a
   where a.user_id = new.user_id
     and coalesce(a.sos_group_id, a.id) <> v_group
     and a.created_at > now() - interval '10 minutes';

  if v_recent > 0 then
    raise exception 'Too many SOS alerts, please wait a few seconds' using errcode = 'RL001';
  end if;

  if v_burst >= 10 then
    raise exception 'Too many SOS alerts, please try again later' using errcode = 'RL001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_limit_sos_alerts on public.sos_alerts;
create trigger trg_limit_sos_alerts before insert on public.sos_alerts
  for each row execute function public.limit_sos_alerts();

-- 30 chat messages a minute is far above typing speed and above sending a
-- handful of photos in a row.
create or replace function public.limit_messages()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if (select count(*) from public.messages m
       where m.user_id = new.user_id and m.created_at > now() - interval '60 seconds') >= 30 then
    raise exception 'Too many messages, please slow down' using errcode = 'RL001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_limit_messages on public.messages;
create trigger trg_limit_messages before insert on public.messages
  for each row execute function public.limit_messages();

create or replace function public.limit_direct_messages()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if (select count(*) from public.direct_messages d
       where d.sender_id = new.sender_id and d.created_at > now() - interval '60 seconds') >= 30 then
    raise exception 'Too many messages, please slow down' using errcode = 'RL001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_limit_direct_messages on public.direct_messages;
create trigger trg_limit_direct_messages before insert on public.direct_messages
  for each row execute function public.limit_direct_messages();

-- Each call, and each person added to a call, is one row (at most 6 people in
-- a call), so 10 a minute leaves room for a conference being built up.
create or replace function public.limit_calls()
 returns trigger
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if (select count(*) from public.calls c
       where c.caller_id = new.caller_id and c.started_at > now() - interval '60 seconds') >= 10 then
    raise exception 'Too many calls, please wait a moment' using errcode = 'RL001';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_limit_calls on public.calls;
create trigger trg_limit_calls before insert on public.calls
  for each row execute function public.limit_calls();

revoke execute on function public.limit_sos_alerts()      from public, anon, authenticated;
revoke execute on function public.limit_messages()        from public, anon, authenticated;
revoke execute on function public.limit_direct_messages() from public, anon, authenticated;
revoke execute on function public.limit_calls()           from public, anon, authenticated;

-- Indexes so each check is a short index range read, not a table scan.
create index if not exists sos_alerts_user_created_idx      on public.sos_alerts (user_id, created_at desc);
create index if not exists messages_user_created_idx        on public.messages (user_id, created_at desc);
create index if not exists direct_messages_sender_created_idx on public.direct_messages (sender_id, created_at desc);
create index if not exists calls_caller_started_idx         on public.calls (caller_id, started_at desc);

-- ── 2. Quota counter for the edge functions ────────────────────────────────
-- A fixed window per key: p_limit calls every p_window_s seconds. The key is a
-- user id for the paid lookups and an address for the registration check.

create table if not exists public.api_quota (
  key    text        not null,
  fn     text        not null,
  bucket timestamptz not null,
  n      integer     not null default 0,
  primary key (key, fn, bucket)
);

alter table public.api_quota enable row level security;
revoke all on public.api_quota from public, anon, authenticated;

drop function if exists public.consume_api_quota(uuid, text, integer, integer);

create or replace function public.consume_api_quota(p_key text, p_fn text, p_limit integer, p_window_s integer)
 returns boolean
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_bucket timestamptz;
  v_n      integer;
begin
  if p_key is null or p_window_s < 1 then
    return true;
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.api_quota as q (key, fn, bucket, n)
  values (p_key, p_fn, v_bucket, 1)
  on conflict (key, fn, bucket) do update set n = q.n + 1
  returning q.n into v_n;
  return v_n <= p_limit;
end;
$function$;

revoke execute on function public.consume_api_quota(text, text, integer, integer) from public, anon, authenticated;
grant  execute on function public.consume_api_quota(text, text, integer, integer) to service_role;

select cron.schedule('purge_api_quota', '0 4 * * *',
  'delete from public.api_quota where bucket < now() - interval ''1 day''');
