-- ═══════════════════════════════════════════════════════════════════════════
-- A device token belongs to the device, not to one family
-- ═══════════════════════════════════════════════════════════════════════════
--
-- usePushNotifications saved the FCM token against the ACTIVE family only. A
-- user in three families therefore had three device_tokens rows, but only one
-- of them was ever refreshed — the other two kept whatever token was current
-- the last time that family happened to be active.
--
-- Observed directly: after a reinstall, the same account's rows read
--
--   58076360…  cjHYLgqdSoy4iJ…  05:14   ← refreshed
--   a269837b…  dw_rkqElTRq-F6…  04:48   ← dead token
--   83e7c360…  dw_rkqElTRq-F6…  03:52   ← dead token
--
-- so a call or SOS raised in either of the other two families was pushed to a
-- token FCM had already invalidated, and simply never arrived. Nothing
-- surfaced: send_call_notification logs the FCM error code and moves on.
--
-- Reinstalling is not the only way in. FCM rotates tokens on its own, and
-- onNewToken fires exactly once for the whole app — whichever family is active
-- at that moment gets the new value and the rest go stale. Every multi-family
-- user drifts into this eventually.
--
-- Fans the token across every family the caller belongs to, in one statement,
-- the same shape as sync_profile_all_families and sync_privacy_all_families.
-- The per-family upsert_device_token is left exactly as it is and stays the
-- client's fallback.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.upsert_device_token_all_families(
  p_token    text,
  p_platform text default 'android'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid  uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Same validation as upsert_device_token, so the two cannot drift.
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

  -- Returned so the client can log how many families were covered, and so a
  -- zero — a user who belongs to nothing yet — is visible rather than silent.
  return v_rows;
end;
$function$;

revoke all on function public.upsert_device_token_all_families(text, text) from public;
grant execute on function public.upsert_device_token_all_families(text, text) to authenticated;
