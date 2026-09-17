-- ===========================================================================
-- A phone rings only for the account signed in on it
--
-- Reported 2026-09-17: calling a family member rang BOTH phones, the callee
-- and the caller.
--
-- send-call-notification pushes to every device_tokens row of the callee.
-- A row is keyed (user_id, family_id) and holds the FCM token of whichever
-- phone that user last registered from. Nothing ever removed a token from
-- the PREVIOUS account on a phone:
--   * signing in as B on a phone that A used before adds rows for B, but
--     the rows for A still hold that same token, and
--   * signing out left the rows in place.
-- So a test phone that had once been signed in as the callee kept receiving
-- the callee calls, SOS alerts, pings and message pushes, even while a
-- different person was signed in on it.
--
-- Three parts:
--   1. Registering a token removes that token from every OTHER account.
--   2. Signing out removes the account tokens (mark_member_signed_out already
--      runs before auth.signOut, while auth.uid() is still known).
--   3. One-off cleanup: where one token is held by several accounts, keep
--      only the most recently updated owner.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

-- ── 1a. Per-family registration (client fallback) ──────────────────────────
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

  if p_token is null or trim(p_token) = '' then
    raise exception 'Device token cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_token) > 4096 then
    raise exception 'Device token too long' using errcode = '22023';
  end if;

  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'Invalid platform: %. Must be android, ios, or web', p_platform using errcode = '22023';
  end if;

  if not is_family_member(p_family_id) then
    raise exception 'Not a member of this family' using errcode = 'PGRST116';
  end if;

  -- This phone now belongs to this account only.
  delete from device_tokens where token = p_token and user_id <> v_uid;

  insert into device_tokens (user_id, family_id, token, platform, updated_at)
  values (v_uid, p_family_id, p_token, p_platform, now())
  on conflict (user_id, family_id)
  do update set
    token      = excluded.token,
    platform   = excluded.platform,
    updated_at = excluded.updated_at;
end;
$function$;

-- ── 1b. All-families registration (what the app calls first) ───────────────
CREATE OR REPLACE FUNCTION public.upsert_device_token_all_families(
  p_token    text,
  p_platform text default 'android'
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_token is null or trim(p_token) = '' then
    raise exception 'Device token cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_token) > 4096 then
    raise exception 'Device token too long' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'Invalid platform: %. Must be android, ios, or web', p_platform
      using errcode = '22023';
  end if;

  -- This phone now belongs to this account only.
  delete from device_tokens where token = p_token and user_id <> v_uid;

  insert into device_tokens (user_id, family_id, token, platform, updated_at)
  select v_uid, fm.family_id, p_token, p_platform, now()
  from family_members fm
  where fm.user_id = v_uid
  on conflict (user_id, family_id)
  do update set
    token      = excluded.token,
    platform   = excluded.platform,
    updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

-- ── 2. Signing out stops pushes to this phone ──────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_member_signed_out()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;

  update family_members
  set signed_out_at = now(),
      is_online     = false
  where user_id = v_uid;

  -- One account, one device: the signed-out phone must not keep receiving
  -- this account calls and alerts. Signing in again re-registers it.
  delete from device_tokens where user_id = v_uid;
end;
$function$;

-- ── 3. One-off cleanup of tokens already shared between accounts ────────────
delete from device_tokens d
using device_tokens newer
where d.token = newer.token
  and d.user_id <> newer.user_id
  and d.updated_at < newer.updated_at;
