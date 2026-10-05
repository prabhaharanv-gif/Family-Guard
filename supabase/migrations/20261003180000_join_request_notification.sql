-- ===========================================================================
-- Tell the family admins when someone asks to join
-- ===========================================================================
--
-- A join request only showed up as a banner on the Family tab, so it sat
-- waiting until an admin happened to open the app. This sends a push to the
-- admins the moment a pending request is created, using the same plumbing as
-- the place and message notifications (trg_notify_edge_function posts the row
-- to the edge function with the service key from the Vault).
--
-- Deploy the send-join-request-notification edge function first, or the
-- trigger will call a function that does not exist yet (harmless: the request
-- itself is unaffected, only the push is missing).
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

drop trigger if exists join_request_notification on public.join_requests;

create trigger join_request_notification
  after insert on public.join_requests
  for each row
  when (new.status = 'pending')
  execute function public.trg_notify_edge_function(
    'https://xiwfmunwodovzpzicyvu.supabase.co/functions/v1/send-join-request-notification'
  );
