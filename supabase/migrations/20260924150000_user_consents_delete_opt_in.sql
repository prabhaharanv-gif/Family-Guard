-- Fix: turning Nearby Help OFF did not actually opt the user out.
--
-- user_consents had select / insert / update policies for the owner but no
-- DELETE policy. With RLS on, a DELETE that no policy allows does not raise
-- an error: it matches zero rows and reports success. So the app showed
-- "off" while the famora_social_visibility row stayed, and
-- find_nearest_opted_in_users kept picking the user as a helper.
--
-- Only the Nearby Help opt-in can be withdrawn this way. Terms-of-service
-- style consents stay undeletable from the client.

create policy "users delete own famora social opt-in" on public.user_consents
  as PERMISSIVE for DELETE to public
  using (auth.uid() = user_id and consent_type = 'famora_social_visibility');
