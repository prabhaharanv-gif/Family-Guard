-- ===========================================================================
-- Resolving an SOS silences it on the family's phones
--
-- Reported 2026-09-18: the sender taps "I am safe now", the alert is resolved
-- in the database — and every family member goes on hearing the siren until
-- they each dismiss it by hand. The alarm had no way to learn the emergency
-- was over: sos_notification only fires on INSERT, so nothing was ever sent
-- when is_resolved flipped.
--
-- This adds the missing trigger. send-sos-notification recognises a resolved
-- record and sends a silent, data-only push (type sos_resolved) which stops
-- SOSSirenService and clears the alert on each phone.
--
-- Fires only on the transition to resolved, so re-saving a resolved row sends
-- nothing.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits statements
-- with a naive tokenizer.
-- ===========================================================================

drop trigger if exists sos_resolved_notification on public.sos_alerts;

create trigger sos_resolved_notification
  AFTER UPDATE on public.sos_alerts
  for each row
  when (new.is_resolved = true and coalesce(old.is_resolved, false) = false)
  EXECUTE FUNCTION trg_notify_edge_function('https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-sos-notification');
