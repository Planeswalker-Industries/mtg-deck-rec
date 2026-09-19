-- LOCAL ONLY. Seeds run on `supabase db reset` against the local database. The hosted project is built from
-- supabase/migrations, which the GitHub integration applies when `main` changes, so nothing here reaches production.
--
-- TODO before any launch: delete this file, or confirm it still cannot reach the hosted project. Two accounts on
-- predictable addresses are fine on a laptop and are not fine on a public site.
--
-- Two fixed accounts, so anything needing sign-in can be tested against the same data every time instead of a fresh
-- random address per run. Sign in with:
--
--   yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts anon
--
-- which mints a link directly and so costs none of the local 30-emails-per-hour budget the e2e tests share.
--
-- "admin" is a real role now: the account below is inserted into public.platform_admins, so it can reach /admin.
-- The "anon" account deliberately is not, so the guard has something to refuse.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- GoTrue reads these into non-nullable strings, so a NULL makes every lookup fail with
  -- "Database error finding user". They have to be empty strings.
  confirmation_token, recovery_token, email_change_token_current, email_change_token_new,
  phone_change_token, reauthentication_token, email_change
)
values
  (
    '00000000-0000-4000-8000-000000000a01', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'anon@test.local', '',
    now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', '', '', '', ''
  ),
  (
    '00000000-0000-4000-8000-0000000000ad', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@test.local', '',
    now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', '', '', '', ''
  )
on conflict (id) do nothing;

-- on_auth_user_created gives each one a profile row; name them so they are obvious in the UI.
update public.profiles set display_name = 'Test anon' where id = '00000000-0000-4000-8000-000000000a01';
update public.profiles set display_name = 'Test admin' where id = '00000000-0000-4000-8000-0000000000ad';

-- The only platform admin locally. Membership is granted by SQL on purpose: there is no way to make the first
-- admin through the app, because every admin write already requires an admin.
insert into public.platform_admins (user_id, note)
values ('00000000-0000-4000-8000-0000000000ad', 'Local test admin')
on conflict (user_id) do nothing;

-- The e2e suite signs in several times per run, and every run comes from one address, so all of it lands in one
-- rate-limit bucket: six sign-ins at two calls each is past the production budget of 10 per 10 minutes. Real
-- visitors don't share a key this way. Local only, like the rest of this file.
update public.app_config
set value = value || '{"auth": {"limit": 100, "windowSeconds": 600}}'::jsonb, updated_at = now()
where key = 'rate_limits';
