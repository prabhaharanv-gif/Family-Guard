-- ══════════════════════════════════════════════════════════════
-- In-app voice/video calling — calls table, RLS, RPCs, notification trigger
-- ══════════════════════════════════════════════════════════════

create table if not exists public.calls (
  id uuid default gen_random_uuid() not null,
  family_id uuid not null,
  caller_id uuid not null,
  callee_id uuid not null,
  agora_channel_name text not null,
  call_type text not null default 'voice'::text,
  status text not null default 'ringing'::text,
  started_at timestamp with time zone default now(),
  answered_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_seconds integer,
  constraint calls_pkey PRIMARY KEY (id),
  constraint calls_agora_channel_name_key UNIQUE (agora_channel_name)
);

alter table public.calls add constraint calls_family_id_fkey FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE;
alter table public.calls add constraint calls_caller_id_fkey FOREIGN KEY (caller_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.calls add constraint calls_callee_id_fkey FOREIGN KEY (callee_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.calls add constraint calls_call_type_check CHECK ((call_type = ANY (ARRAY['voice'::text, 'video'::text])));
alter table public.calls add constraint calls_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'accepted'::text, 'declined'::text, 'ended'::text, 'missed'::text])));
alter table public.calls add constraint calls_not_self_check CHECK ((caller_id <> callee_id));

create index if not exists calls_callee_id_idx on public.calls (callee_id);
create index if not exists calls_caller_id_idx on public.calls (caller_id);
create index if not exists calls_family_id_idx on public.calls (family_id);

-- ══════════════════════════════════════════════════════════════
-- Row level security — participants can read, all writes via RPC only
-- ══════════════════════════════════════════════════════════════
alter table public.calls enable row level security;

create policy "participants read own calls" on public.calls
  as PERMISSIVE for SELECT to public
  using ((auth.uid() = caller_id) or (auth.uid() = callee_id));
create policy "no direct client insert on calls" on public.calls
  as PERMISSIVE for INSERT to authenticated
  with check (false);
create policy "no direct client update on calls" on public.calls
  as PERMISSIVE for UPDATE to public
  using (false);
create policy "no direct client delete on calls" on public.calls
  as PERMISSIVE for DELETE to public
  using (false);
create policy "service_role_all_calls" on public.calls
  as PERMISSIVE for ALL to service_role
  using (true)
  with check (true);

-- ══════════════════════════════════════════════════════════════
-- RPCs
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_call(p_family_id uuid, p_callee_id uuid, p_call_type text DEFAULT 'voice'::text)
 RETURNS public.calls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_call calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_callee_id = v_uid then
    raise exception 'Cannot call yourself' using errcode = '22023';
  end if;

  if p_call_type not in ('voice', 'video') then
    raise exception 'Invalid call_type: %', p_call_type using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  if not exists (
    select 1 from family_members
    where family_id = p_family_id and user_id = p_callee_id
  ) then
    raise exception 'Callee is not a member of this family' using errcode = '22023';
  end if;

  insert into calls (family_id, caller_id, callee_id, agora_channel_name, call_type)
  values (p_family_id, v_uid, p_callee_id, 'call_' || replace(gen_random_uuid()::text, '-', ''), p_call_type)
  returning * into v_call;

  return v_call;
end;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_call(p_call_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_call calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  if p_action not in ('accept', 'decline') then
    raise exception 'Invalid action: %', p_action using errcode = '22023';
  end if;

  select * into v_call from calls where id = p_call_id for update;
  if v_call.id is null then
    raise exception 'Call not found' using errcode = 'PGRST116';
  end if;
  if v_call.callee_id <> v_uid then
    raise exception 'Only the callee can respond to this call' using errcode = 'PGRST301';
  end if;
  if v_call.status <> 'ringing' then
    raise exception 'Call is no longer ringing' using errcode = '22023';
  end if;

  if p_action = 'accept' then
    update calls set status = 'accepted', answered_at = now() where id = p_call_id;
  else
    update calls set status = 'declined', ended_at = now() where id = p_call_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.end_call(p_call_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_call calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_call from calls where id = p_call_id for update;
  if v_call.id is null then
    raise exception 'Call not found' using errcode = 'PGRST116';
  end if;
  if v_uid not in (v_call.caller_id, v_call.callee_id) then
    raise exception 'Not a participant of this call' using errcode = 'PGRST301';
  end if;
  if v_call.status in ('ended', 'declined', 'missed') then
    return; -- already finalized — no-op, avoids clobbering ended_at/duration on double-hangup
  end if;

  update calls
  set status = 'ended',
      ended_at = now(),
      duration_seconds = case
        when v_call.answered_at is not null then extract(epoch from (now() - v_call.answered_at))::int
        else null
      end
  where id = p_call_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_call_missed(p_call_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_call calls%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'PGRST301';
  end if;

  select * into v_call from calls where id = p_call_id for update;
  if v_call.id is null then
    raise exception 'Call not found' using errcode = 'PGRST116';
  end if;
  if v_call.caller_id <> v_uid then
    raise exception 'Only the caller can mark a call missed' using errcode = 'PGRST301';
  end if;
  if v_call.status <> 'ringing' then
    return; -- callee already responded — don't clobber accept/decline with a race
  end if;

  update calls set status = 'missed', ended_at = now() where id = p_call_id;
end;
$function$;

-- ══════════════════════════════════════════════════════════════
-- Push notification trigger — reuses the existing generic webhook function
-- ══════════════════════════════════════════════════════════════
create trigger call_notification
  AFTER INSERT on public.calls
  for each row EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-call-notification');

-- ══════════════════════════════════════════════════════════════
-- Realtime — so postgres_changes subscriptions fire for this table
-- ══════════════════════════════════════════════════════════════
alter publication supabase_realtime add table public.calls;
