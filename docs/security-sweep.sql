-- Security sweep: run in the Supabase SQL Editor. Read-only, changes nothing.
-- Lists only exceptions worth a look. An empty first three groups is the goal;
-- the last group should contain only functions that RLS policies or storage
-- policies call, or that the app calls in a way the source search missed.
-- (No apostrophes in comments: the editor splits statements naively.)

select 'A. table with RLS off' as check_name, schemaname || '.' || tablename as detail
from pg_tables
where schemaname = 'public' and not rowsecurity
union all
select 'B. policy open to everyone (true)',
       schemaname || '.' || tablename || ' / ' || policyname || ' / ' || cmd || ' / ' || array_to_string(roles, ',')
from pg_policies
where schemaname in ('public', 'storage')
  and (qual = 'true' or with_check = 'true')
  and not ('service_role' = any (roles))
union all
select 'C. public storage bucket', id from storage.buckets where public
union all
select 'D. definer fn signed-in users can run, app does not call',
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute')
  and p.proname <> all (array['accept_join_request','accept_nearby_help','add_family_contact','attach_sos_media','claim_active_device','clear_call_history','clear_direct_thread','clear_family_chat_for_me','clear_sos_history','create_call','create_family_with_membership','decline_nearby_help','delete_calls','delete_direct_message','delete_message','delete_my_account','delete_place','edit_direct_message','edit_message','end_call','get_accepted_helper_area','get_nearby_help_location','hide_message','is_active_device','leave_family','list_famora_social_dots','list_my_places','mark_call_missed','mark_direct_thread_read','mark_member_signed_out','mark_messages_read','reject_join_request','remove_family_member','rename_place','report_place_transition','reset_password_verified','resolve_sos','respond_to_call','save_place','send_device_ping','send_direct_message','send_message','send_sos','send_sos_all_families','set_location_status','set_member_nickname','set_member_offline','set_message_reaction','set_network_status','start_lost_phone','stop_lost_phone','submit_join_request','sync_avatar_all_families','sync_location_sharing_all_families','sync_privacy_all_families','sync_profile_all_families','update_family_name','update_member_avatar','update_member_heartbeat','upsert_device_token','upsert_device_token_all_families','upsert_location','upsert_location_all_families','upsert_location_with_battery'])
order by 1, 2;
