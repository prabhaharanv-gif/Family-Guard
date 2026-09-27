-- Any member of a family the phone's owner shares can mark that phone lost (or
-- found), not only a family admin. The owner's own opt-in is unchanged and still
-- the gate: start_lost_phone refuses unless the target has allow_lost_mode on.
create or replace function public._can_manage_lost_phone(p_target uuid)
 returns boolean
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() = p_target
      or exists (
        select 1 from public.family_members me
          join public.family_members them on them.family_id = me.family_id
         where me.user_id = auth.uid() and them.user_id = p_target
      );
$function$;

revoke execute on function public._can_manage_lost_phone(uuid) from public, anon, authenticated;
