-- Registration diagnostic: run in the Supabase SQL Editor, one block at a time.
-- Run Block 2 first if you want to rule out a stale API cache, then Block 1.
-- Each block is read-only. Replace 91XXXXXXXXXX with the number you tested,
-- as 91 followed by the ten digits, no plus sign and no spaces.
-- (No apostrophes in comments: the editor splits statements naively.)

-- ── Block 1: the accounts for that number, and what the check says for each ──
-- Only the number needs replacing (91 followed by the ten digits, twice below).
-- Two rows means the same number now has two accounts. has_password shows
-- whether registration was completed on each; nothing secret is shown. The
-- taken column is what registration_number_taken() answers when that account
-- is the one signed in: it should be true for an account that is already
-- registered. Read-only: the caller is set for this one statement only.
select u.id,
       u.created_at,
       u.last_sign_in_at,
       u.phone,
       u.email,
       (coalesce(u.encrypted_password, '') <> '') as has_password,
       u.raw_user_meta_data ->> 'display_name'    as display_name,
       t.taken
from auth.users u
cross join lateral (
  select set_config('request.jwt.claims',
           json_build_object('sub', u.id::text, 'phone', '91XXXXXXXXXX', 'role', 'authenticated')::text,
           true) as c
) s
cross join lateral (
  select public.registration_number_taken() as taken where s.c is not null
) t
where regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = '91XXXXXXXXXX'
   or lower(coalesce(u.email, '')) = '91XXXXXXXXXX@familyguard.app'
order by u.created_at;


-- ── Block 2: make the API pick up the function ───────────────────────────────
-- Harmless. If the API never learned about the new function, the app call fails.
notify pgrst, 'reload schema';
