-- Stop clients rewriting privileged columns on their own family_members row.
--
-- The effective UPDATE rule on family_members is:
--
--   "Members can update own last_active"      USING (auth.uid() = user_id)  PERMISSIVE
--   "no direct client update on family_members" USING (false)               PERMISSIVE, inert
--
-- which ORs down to (auth.uid() = user_id), with WITH CHECK defaulting to the
-- same expression. RLS cannot restrict WHICH COLUMNS an update touches — only
-- column-level GRANTs can — and UPDATE was granted on the whole table to
-- authenticated. The policy is named for last_active but confines nothing.
--
-- That allows a privilege escalation in a single PostgREST call:
--
--   update family_members set role = 'admin' where user_id = <self>
--
-- is_family_admin() then returns true, unlocking remove_family_member,
-- change_member_role, clear_family_messages, update_family_name and the
-- join-request approval path. Verified against Postgres 16: the update
-- succeeds under the current policies.
--
-- family_id is NOT currently exploitable, though only by accident. Rewriting
-- your own row's family_id would move your membership into any family whose
-- UUID you know, and is_family_member() would then open that family's
-- locations, messages and SOS alerts. PostgreSQL blocks it because an UPDATE
-- carrying a WHERE clause requires the NEW row to satisfy the table's SELECT
-- policy, and that policy is is_family_member(family_id) — so the moved row
-- would be invisible to the mover and is rejected. That protection is an
-- emergent side effect of the SELECT policy, not an intentional control: it
-- disappears the moment anyone broadens that policy. The grant below makes
-- the restriction explicit rather than incidental.
--
-- The fix is a column-level grant covering exactly the columns the app writes
-- directly. Those are the fallback paths in ProfilePage and MapPage after
-- their SECURITY DEFINER RPCs fail; everything else on this table is written
-- only through RPCs, which run as the function owner and are unaffected by
-- client grants.
--
-- Deliberately NOT grantable: id, family_id, user_id, role, joined_at.

REVOKE UPDATE ON public.family_members FROM authenticated, anon;

GRANT UPDATE (
  display_name,
  phone,
  avatar_url,
  show_location,
  show_online,
  show_last_seen,
  last_active
) ON public.family_members TO authenticated;

-- Drop the inert deny policy. It is PERMISSIVE beside a permissive allow, so
-- it never denied anything, and leaving a policy that reads as a guardrail
-- but enforces nothing is what hid the sos_alerts hole. It is not recreated
-- AS RESTRICTIVE because the app's fallback paths legitimately need this
-- table's UPDATE; the column grant above is the real control.
DROP POLICY IF EXISTS "no direct client update on family_members" ON public.family_members;
