-- Enforce "Show My Location" in the database, not just in the app.
--
-- ── The problem ────────────────────────────────────────────────────────────
-- locations had four client-facing SELECT policies. Only one of them
-- ("members see non-zero sharing locations in family") checked is_sharing.
-- Postgres OR-s PERMISSIVE policies together, so the three that did not check
-- it defeated the one that did: any family member could read another member's
-- coordinates through the REST API even after that member switched location
-- sharing off. location_history was worse — two policies, neither checking
-- sharing state, over a rolling 7 days of movement.
--
-- The app itself was never wrong: useLocations.js filters .eq('is_sharing',
-- true) on load and drops the pin on any update that is not sharing. The gap
-- was that nothing stopped a family member from bypassing the app and calling
-- PostgREST directly with their own ordinary JWT. For a family-safety app the
-- person a user wants to hide from is usually inside the family, so the toggle
-- has to hold at the database.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- Collapse the duplicates into one SELECT policy per table that says: you can
-- always read your own row, and you can read a family member's row only while
-- they are actually sharing. Because there is then exactly one permissive
-- SELECT policy, no weaker sibling can OR its way past it.
--
-- ── Why no client change is needed ─────────────────────────────────────────
-- Hiding the row makes the realtime re-fetch in useLocations.js return null,
-- and that path already exists — it treats a missing row as "remove the pin",
-- which is exactly the behaviour wanted when someone stops sharing. The
-- initial fetchAll() already filters on is_sharing, so it is unaffected.
--
-- ── Deliberately unchanged ─────────────────────────────────────────────────
-- sos_alerts also ignores is_sharing. That is correct: an emergency alert must
-- reach the family whatever the sharing toggle says, and its location is the
-- point of the alert.

-- ── locations ──────────────────────────────────────────────────────────────
drop policy if exists "Family members can view locations"                  on public.locations;
drop policy if exists "family members can read locations"                  on public.locations;
drop policy if exists "locations read same family"                         on public.locations;
drop policy if exists "members see non-zero sharing locations in family"   on public.locations;

create policy "read own location or a sharing family member"
  on public.locations
  as permissive for select
  to public
  using (
    -- Your own row is always visible to you: the map still needs to draw you
    -- after you switch sharing off, and Profile reads it back to show state.
    user_id = auth.uid()
    or (
      is_sharing = true
      and exists (
        select 1
        from public.family_members fm
        where fm.family_id = locations.family_id
          and fm.user_id   = auth.uid()
      )
    )
  );

-- ── location_history ───────────────────────────────────────────────────────
-- No is_sharing column here, so current sharing state is read from locations.
-- Switching sharing off therefore also closes the back door to the trail
-- already recorded, which is what a user turning the toggle off expects.
drop policy if exists "Family can view location history" on public.location_history;
drop policy if exists "family read history"              on public.location_history;

create policy "read own history or a sharing family member"
  on public.location_history
  as permissive for select
  to public
  using (
    user_id = auth.uid()
    or (
      exists (
        select 1
        from public.family_members fm
        where fm.family_id = location_history.family_id
          and fm.user_id   = auth.uid()
      )
      and exists (
        select 1
        from public.locations l
        where l.user_id    = location_history.user_id
          and l.family_id  = location_history.family_id
          and l.is_sharing = true
      )
    )
  );
