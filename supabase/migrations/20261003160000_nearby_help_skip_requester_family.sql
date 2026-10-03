-- ===========================================================================
-- Nearby Help: never ask the family of the person in danger
-- ===========================================================================
--
-- Nearby Help is for the case where the family is too far away to help. The
-- candidate search only left out the requester and people already notified,
-- so a family member who had opted in and was within range got the family SOS
-- alert AND a Nearby Help request for the same event. The family already has
-- the full alert with the exact position, so the extra request is noise.
--
-- This is find_nearest_opted_in_users as it stood (phone must be confirmed)
-- with one more rule: nobody who shares a family with the requester is a
-- candidate. CREATE OR REPLACE keeps the existing grants, so the function
-- stays closed to clients.
--
-- NOTE: no apostrophes in comments. The dashboard SQL Editor splits
-- statements with a naive tokenizer.
-- ===========================================================================

create or replace function public.find_nearest_opted_in_users(
  p_lat double precision, p_lng double precision, p_radius_m double precision,
  p_requester_id uuid, p_exclude_user_ids uuid[], p_limit int default 10
) returns table(user_id uuid, distance_m double precision)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $fn$
  with candidates as (
    select distinct on (l.user_id) l.user_id, l.lat, l.lng
    from public.locations l
    join public.user_consents c
      on c.user_id = l.user_id and c.consent_type = 'famora_social_visibility'
    join auth.users u
      on u.id = l.user_id and u.phone_confirmed_at is not null
    where l.is_sharing = true
      and l.lat is not null and l.lng is not null
      and not (l.lat = 0 and l.lng = 0)
      and l.updated_at > now() - interval '30 minutes'
      and l.user_id <> p_requester_id
      and l.user_id <> all(p_exclude_user_ids)
      and not exists (
        select 1
          from public.family_members mine
          join public.family_members theirs on theirs.family_id = mine.family_id
         where mine.user_id = p_requester_id
           and theirs.user_id = l.user_id
      )
      and l.lat between p_lat - (p_radius_m / 111000.0) and p_lat + (p_radius_m / 111000.0)
      and l.lng between p_lng - (p_radius_m / 111000.0 / cos(radians(p_lat)))
                     and p_lng + (p_radius_m / 111000.0 / cos(radians(p_lat)))
    order by l.user_id, l.updated_at desc
  ), distanced as (
    select user_id,
      2 * 6371000 * asin(sqrt(
        sin(radians(lat - p_lat) / 2) ^ 2
        + cos(radians(p_lat)) * cos(radians(lat)) * sin(radians(lng - p_lng) / 2) ^ 2
      )) as distance_m
    from candidates
  )
  select user_id, distance_m from distanced
  where distance_m <= p_radius_m
  order by distance_m asc
  limit p_limit;
$fn$;

notify pgrst, 'reload schema';
