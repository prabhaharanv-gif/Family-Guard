-- Make family_members realtime membership explicit.
--
-- FamilyPage has long subscribed to UPDATEs on this table (that is what keeps
-- the Online dot and "last seen" fresh), so in practice it was already in the
-- supabase_realtime publication — added by hand in the dashboard, never
-- recorded in a migration. That left a working behaviour resting on state no
-- migration reproduces: a rebuilt or branched database would come up with the
-- member list silently frozen, and nothing in the repo would say why.
--
-- It matters more now. Newly joined members were missing from the family list
-- and from the Personal chat's member picker, because nothing anywhere watched
-- for family_members INSERTs — joining with a family code writes straight into
-- this table with no join_request to accept, and the one UPDATE handler that
-- did exist patches state with map(), which cannot add a member it has never
-- seen. Their heartbeats were dropped along with them, pinning a genuinely
-- active member on "No activity yet" indefinitely. Both screens now subscribe
-- to INSERT/DELETE here, so that subscription must be guaranteed, not assumed.
--
-- Idempotent, and safe to run against a database where it is already present.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'family_members'
  ) then
    alter publication supabase_realtime add table public.family_members;
  end if;
end $$;
