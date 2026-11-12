-- ============================================================================
-- Tell the caller when the ring has been sent to the other phone
-- ============================================================================
--
-- The caller screen said Calling for the whole time the other phone rang, because
-- nothing told it the ring had gone out. send-call-notification now stamps this
-- column once FCM has accepted the push for at least one of the callee devices, and
-- the caller screen switches to Ringing when it sees it (the call row is already
-- watched over realtime).
--
-- It means the ring was handed to the phone, not that the phone is sounding: a
-- phone that is off or without signal still gets the stamp once FCM accepts it.
--
-- Deploy the edge function after running this. Until then the column stays empty
-- and the caller screen keeps saying Calling, exactly as before.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.

alter table public.calls
  add column if not exists ring_sent_at timestamptz;
