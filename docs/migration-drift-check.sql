-- Migration drift check: run in the Supabase SQL Editor. Read-only.
-- Lists what the migration files say should exist but does not exist live,
-- and what they say was dropped but still exists. An empty result means the
-- live database matches the files. (No apostrophes in comments.)

select 'function missing live' as problem, n as name
from unnest(array['_can_manage_lost_phone','_device_alert_emit','_device_back_online','_device_battery_alert','_haversine_m','_nearby_help_notify_tier','_nearby_help_safe_unschedule','_overspeed_alert','_start_nearby_help_escalation','_trip_track','accept_join_request','accept_nearby_help','account_phone','add_family_contact','advance_nearby_help_tier','attach_sos_media','attach_unlock_photo','can_view_sos_media','can_view_unlock_photo','change_member_role','claim_active_device','clear_call_history','clear_direct_thread','clear_family_chat_for_me','clear_family_messages','clear_sos_history','close_stale_trips','create_call','create_family_with_membership','decline_nearby_help','delete_calls','delete_direct_message','delete_message','delete_my_account','delete_place','detect_offline_members','edit_direct_message','edit_message','end_call','existing_display_name','family_joined_at','find_nearest_opted_in_users','get_accepted_helper_area','get_nearby_help_location','hide_message','hide_nearby_help_escalation','hide_nearby_help_notification','is_active_device','is_family_admin','is_family_member','leave_family','list_famora_social_dots','list_my_places','log_audit_event','mark_call_missed','mark_direct_thread_read','mark_member_signed_out','mark_messages_read','purge_expired_sos_media','purge_expired_unlock_alerts','reject_join_request','remove_family_member','rename_place','report_place_transition','report_unlock_attempts','reset_password_verified','resolve_sos','respond_to_call','run_place_weather_check','save_place','send_device_ping','send_sos','send_sos_all_families','set_location_sharing','set_location_status','set_member_nickname','set_member_offline','set_message_reaction','set_network_status','start_lost_phone','stop_lost_phone','submit_join_request','sync_avatar_all_families','sync_location_sharing_all_families','sync_privacy_all_families','sync_profile_all_families','trg_audit_member_removal','trg_audit_sos','trg_notify_edge_function','try_uuid','update_family_name','update_member_avatar','update_member_heartbeat','update_member_privacy','update_member_profile','upsert_device_token','upsert_device_token_all_families','upsert_location','upsert_location_with_battery']) as n
where not exists (
  select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = n)
union all
select 'table missing live', n
from unnest(array['audit_log','calls','device_alerts','device_pings','device_tokens','direct_messages','families','family_members','hidden_messages','join_requests','location_history','locations','lost_phone','member_nicknames','message_reactions','message_reads','messages','nearby_help_escalations','nearby_help_notifications','place_events','place_weather_alerts','places','sos_alerts','sos_media','trips','unlock_alerts','user_active_device','user_alert_prefs','user_consents','user_profiles']) as n
where not exists (
  select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = n)
union all
select 'dropped by a migration but still live', p.proname
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public' and p.proname = '_debug_nearby_help'
union all
select 'dropped by a migration but still live', c.relname
from pg_class c join pg_namespace s on s.oid = c.relnamespace
where s.nspname = 'public' and c.relname = 'geofences'
order by 1, 2;
