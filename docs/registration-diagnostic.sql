-- Registration diagnostic: run in the Supabase SQL Editor, one block at a time.
-- Each block is read-only. Replace 91XXXXXXXXXX with the number you tested,
-- as 91 followed by the ten digits, no plus sign and no spaces.
-- (No apostrophes in comments: the editor splits statements naively.)

-- ── Block 1: which accounts exist for that number ────────────────────────────
-- Two rows means the same number now has two accounts. has_password shows
-- whether registration was completed on each. Nothing secret is shown.
select u.id,
       u.created_at,
       u.last_sign_in_at,
       u.phone,
       u.email,
       (coalesce(u.encrypted_password, '') <> '') as has_password,
       u.raw_user_meta_data ->> 'display_name'    as display_name
from auth.users u
where regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = '91XXXXXXXXXX'
   or lower(coalesce(u.email, '')) = '91XXXXXXXXXX@familyguard.app'
order by u.created_at;


-- ── Block 2: what the check answers for each of those accounts ───────────────
-- Paste an id from Block 1 in place of THE-ID. Run once per row. It only sets
-- the caller for this one statement; nothing is written.
-- Expected: true for an account that is already registered.
select s.c is not null as claims_set, t.taken
from (select set_config('request.jwt.claims',
        json_build_object('sub', 'THE-ID', 'phone', '91XXXXXXXXXX', 'role', 'authenticated')::text,
        true) as c) s,
     lateral (select public.registration_number_taken() as taken) t;


-- ── Block 3: make the API pick up the function ───────────────────────────────
-- Harmless. If the API never learned about the new function, the app call fails.
notify pgrst, 'reload schema';
