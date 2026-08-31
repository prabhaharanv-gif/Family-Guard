-- Make the "no direct client ..." policies actually deny.
--
-- Every one of these was created as PERMISSIVE. PostgreSQL combines permissive
-- policies for the same command with OR, so a policy of WITH CHECK (false)
-- sitting beside a permissive allow policy contributes nothing — the allow
-- wins and the deny is inert. They read like guardrails in the policy list
-- while enforcing nothing.
--
-- The one that mattered: sos_alerts INSERT paired
--
--   "Users can create SOS alerts"           WITH CHECK (auth.uid() = user_id)
--   "no direct client insert on sos_alerts" WITH CHECK (false)
--
-- which OR'd down to (auth.uid() = user_id) with NO family membership check.
-- Any authenticated user could therefore insert an SOS row naming an
-- arbitrary family_id. The send-sos-notification webhook then fired, and its
-- record-existence check passed because the attacker had just created the
-- record it verifies — fanning a full-volume siren out to every device in a
-- family the attacker has nothing to do with. Compare the messages INSERT
-- policy, which correctly requires is_family_member(family_id).
--
-- All of these tables are written through SECURITY DEFINER RPCs in the app
-- (send_sos, resolve_sos, send_device_ping, create_call, submit_join_request,
-- send_direct_message, claim_active_device), never by direct client writes,
-- so denying direct access changes no supported behaviour.
--
-- The restrictive policies are scoped TO authenticated, anon rather than
-- public so that service_role is unaffected regardless of its BYPASSRLS
-- setting.
--
-- family_members is deliberately NOT touched here: the app does fall back to
-- direct updates on that table, so it needs column-level grants instead of a
-- blanket deny. That is handled separately.

-- ── sos_alerts ───────────────────────────────────────────────────────────────
-- Close the cross-family hole in the allow policy itself, so the table is
-- correct even if the restrictive policy below is ever dropped.
DROP POLICY IF EXISTS "Users can create SOS alerts" ON public.sos_alerts;
CREATE POLICY "member creates own sos alert in own family"
  ON public.sos_alerts AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_family_member(family_id));

DROP POLICY IF EXISTS "no direct client insert on sos_alerts" ON public.sos_alerts;
CREATE POLICY "no direct client insert on sos_alerts"
  ON public.sos_alerts AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "no direct client update on sos_alerts" ON public.sos_alerts;
CREATE POLICY "no direct client update on sos_alerts"
  ON public.sos_alerts AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS "no direct client delete on sos_alerts" ON public.sos_alerts;
CREATE POLICY "no direct client delete on sos_alerts"
  ON public.sos_alerts AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);

-- ── calls ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "no direct client insert on calls" ON public.calls;
CREATE POLICY "no direct client insert on calls"
  ON public.calls AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "no direct client update on calls" ON public.calls;
CREATE POLICY "no direct client update on calls"
  ON public.calls AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS "no direct client delete on calls" ON public.calls;
CREATE POLICY "no direct client delete on calls"
  ON public.calls AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);

-- ── device_pings ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "no direct client insert on device_pings" ON public.device_pings;
CREATE POLICY "no direct client insert on device_pings"
  ON public.device_pings AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

-- ── direct_messages ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "no direct client insert on direct_messages" ON public.direct_messages;
CREATE POLICY "no direct client insert on direct_messages"
  ON public.direct_messages AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

-- ── families ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "no direct client update on families" ON public.families;
CREATE POLICY "no direct client update on families"
  ON public.families AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false);

-- ── join_requests ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "no direct client insert on join_requests" ON public.join_requests;
CREATE POLICY "no direct client insert on join_requests"
  ON public.join_requests AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

-- ── user_active_device ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "no direct client insert on active device" ON public.user_active_device;
CREATE POLICY "no direct client insert on active device"
  ON public.user_active_device AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "no direct client update on active device" ON public.user_active_device;
CREATE POLICY "no direct client update on active device"
  ON public.user_active_device AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false);

DROP POLICY IF EXISTS "no direct client delete on active device" ON public.user_active_device;
CREATE POLICY "no direct client delete on active device"
  ON public.user_active_device AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);
