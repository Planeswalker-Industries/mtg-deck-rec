-- LOCAL ONLY. Fills the database with a cast of demo accounts so /admin has something to show: several pages of
-- users, both kinds of admin, a banned account, people with decks and collections and people with neither.
--
-- Run it against the running local database (it commits; it is a seed, not a test):
--
--   docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres -q < supabase/demo/admin-demo.sql
--
-- Then sign in as the admin and open /admin:
--
--   yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts admin /admin
--
-- It is NOT wired into `supabase db reset`: config.toml's db.seed.sql_paths lists only ./seed.sql, and this script
-- needs the synced catalog, which a fresh reset does not have. Run it by hand, after the catalog is in.
--
-- Re-running it is safe and gives the same result every time. Everything it owns lives on **@demo.local**, and the
-- only rows it ever deletes are accounts at that address — so it cannot touch a real user, and it leaves the two
-- accounts from supabase/seed.sql (anon@test.local, admin@test.local) alone apart from making the admin an admin.
--
-- TODO before any launch: this goes with supabase/seed.sql and scripts/dev-sign-in.ts. Delete all three, or prove
-- they cannot reach the hosted project.
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Start from a clean cast
-- ---------------------------------------------------------------------------
-- Deleting the account takes its profile, decks, collection and any platform_admins row with it, through the
-- cascades those tables already declare. Nothing else is touched.
delete from auth.users where email like '%@demo.local';

-- ---------------------------------------------------------------------------
-- The named accounts, each one there to show a different state in the list
-- ---------------------------------------------------------------------------
-- These five are the newest accounts in the database on purpose. The list opens sorted by "Joined" descending, so
-- the rows worth looking at — the second admin, the banned account, the ones with decks and collections — are the
-- ones on the first page. The filler below is deliberately older. GoTrue reads the token columns into non-nullable
-- strings, so they have to be empty strings rather than NULL.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at, banned_until, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_current, email_change_token_new,
  phone_change_token, reauthentication_token, email_change
)
select
  d.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', d.email, '',
  d.confirmed_at, d.last_sign_in, d.banned_until, d.joined, now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', ''
from (values
  -- id                                      email                         joined                     confirmed                  last sign-in               banned until
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'demo-admin@demo.local',    now() - interval '12 days',  now() - interval '12 days',  now() - interval '2 hours',  null::timestamptz),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'demo-player@demo.local',   now() - interval '9 days',   now() - interval '9 days',   now() - interval '1 day',    null),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'demo-collector@demo.local',now() - interval '7 days',   now() - interval '7 days',   now() - interval '9 hours',  null),
  ('d0000000-0000-4000-8000-000000000004'::uuid, 'demo-banned@demo.local',   now() - interval '5 days',   now() - interval '5 days',   now() - interval '31 hours', now() + interval '100 years'),
  -- Signed up, never confirmed the address, never signed in: both columns read "never" in the list.
  ('d0000000-0000-4000-8000-000000000005'::uuid, 'demo-newcomer@demo.local', now() - interval '3 days',   null,                        null,                        null)
) as d(id, email, joined, confirmed_at, last_sign_in, banned_until);

-- ---------------------------------------------------------------------------
-- Filler, so the list is worth paging and sorting
-- ---------------------------------------------------------------------------
-- 25 rows per page by default, and the five above plus the two from seed.sql do not reach it. Twenty-two more put
-- the list over the edge. They all joined more than a month ago, so they sort below the five that matter, and their
-- sign-in dates are spread so "Last sign-in" sorts into a real order, with every fourth account never signed in.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_current, email_change_token_new,
  phone_change_token, reauthentication_token, email_change
)
select
  ('d0000000-0000-4000-8000-1' || lpad(n::text, 11, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'demo-player-' || lpad(n::text, 2, '0') || '@demo.local', '',
  now() - (30 + n * 11 || ' days')::interval,
  case when n % 4 <> 0 then now() - (20 + n * 3 || ' days')::interval end,
  now() - (30 + n * 11 || ' days')::interval, now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', '', '', '', ''
from generate_series(1, 22) as n;

-- ---------------------------------------------------------------------------
-- Display names
-- ---------------------------------------------------------------------------
-- on_auth_user_created already gave every account above a profile row. Names go on some and not others, because
-- "no display name" is a real state the list has to render.
update public.profiles p set display_name = v.name
from (values
  ('demo-admin@demo.local',     'Dana (demo admin)'),
  ('demo-player@demo.local',    'Pip Brewmaster'),
  ('demo-collector@demo.local', 'Cass the Hoarder'),
  ('demo-banned@demo.local',    'Spam Account')
) as v(email, name)
join auth.users u on u.email = v.email
where p.id = u.id;

update public.profiles p set display_name = 'Demo player ' || substring(u.email from 'demo-player-([0-9]+)@')
from auth.users u
where p.id = u.id and u.email like 'demo-player-%@demo.local' and substring(u.email from 'demo-player-([0-9]+)@')::int % 3 <> 0;

-- ---------------------------------------------------------------------------
-- Platform admins
-- ---------------------------------------------------------------------------
-- Two of them, so the Platform admins list has more than one row and the "you cannot revoke yourself" and "the last
-- admin cannot be removed" guards can both be tried without locking yourself out. The seeded admin is ensured here
-- as well, because it is the account dev-sign-in.ts knows how to sign in as.
insert into public.platform_admins (user_id, note)
select u.id, v.note
from (values
  ('admin@test.local',       'Local test admin'),
  ('demo-admin@demo.local',  'Demo admin — safe to revoke, ban or delete')
) as v(email, note)
join auth.users u on u.email = v.email
on conflict (user_id) do update set note = excluded.note
where public.platform_admins.note is distinct from excluded.note;

-- ---------------------------------------------------------------------------
-- Decks
-- ---------------------------------------------------------------------------
-- Built through save_deck rather than by inserting rows, so they come out exactly like decks somebody saved: the
-- commander, colour identity, card count and corpus flag are all derived by the function. It reads auth.uid() from
-- the request.jwt.claims setting, which is the only thing that has to be faked — it is security definer, so there
-- is no need to change role on top of that.
--
-- Skipped entirely when the catalog has not been synced yet: decks reference public.cards, and there is nothing
-- here worth failing a seed over.
do $$
declare
  v_deck record;
  v_cmd integer;
  v_land integer;
  v_staples integer[];
  v_cards jsonb;
begin
  if not exists (select 1 from public.cards where deleted_at is null limit 1) then
    raise notice 'No catalog in this database, so the demo accounts have no decks. Run `yarn workspace @mtg/worker cli sync:catalog`, then this script again.';
    return;
  end if;

  select array_agg(c.id order by c.slug) into v_staples
  from public.cards c
  where c.slug in ('sol-ring', 'arcane-signet', 'command-tower', 'swords-to-plowshares', 'counterspell', 'lightning-bolt', 'cultivate')
    and c.deleted_at is null;

  for v_deck in
    select * from (values
      ('demo-player@demo.local',    'Liesa Aristocrats',      'liesa-forgotten-archangel', 'plains',   3),
      ('demo-player@demo.local',    'Atraxa Superfriends',    'atraxa-praetors-voice',     'forest',   4),
      ('demo-player@demo.local',    'Krenko Goes Wide',       'krenko-mob-boss',           'mountain', 2),
      ('demo-banned@demo.local',    'Talrand Tempo',          'talrand-sky-summoner',      'island',   3),
      ('demo-admin@demo.local',     'Admin Test Deck',        'liesa-forgotten-archangel', 'swamp',    null)
    ) as d(email, name, commander_slug, basic_slug, bracket)
  loop
    select id into v_cmd from public.cards where slug = v_deck.commander_slug and deleted_at is null;
    select id into v_land from public.cards where slug = v_deck.basic_slug and deleted_at is null;
    continue when v_cmd is null or v_land is null;

    -- One commander, a handful of staples, and basics making the count up to 100, so the deck reads as a real one.
    v_cards := jsonb_build_array(jsonb_build_object('cardId', v_cmd, 'quantity', 1, 'section', 'commander'))
      || coalesce((
           select jsonb_agg(jsonb_build_object('cardId', s, 'quantity', 1, 'section', 'main'))
           from unnest(v_staples) as s
         ), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
           'cardId', v_land, 'quantity', 99 - coalesce(array_length(v_staples, 1), 0), 'section', 'main'));

    perform set_config('request.jwt.claims',
      json_build_object('sub', (select id from auth.users where email = v_deck.email))::text, true);
    perform public.save_deck(null, v_deck.name, v_cards, v_deck.bracket::smallint);
  end loop;

  perform set_config('request.jwt.claims', '', true);
end $$;

-- A private deck and a public one, so the visibility column is not all the same. New decks are public.
update public.decks set is_public = false where name in ('Krenko Goes Wide', 'Admin Test Deck');

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
-- Inserted directly rather than through the import functions: the admin list only counts these rows, and a real
-- import is three calls and a staging table for no extra signal. printing_id stays null, which is the "no particular
-- printing" case the table already allows.
insert into public.collection_items (user_id, card_id, printing_id, finish, condition, lang, quantity)
select u.id, c.id, null, 'nonfoil', 'NM', 'en', 1 + (c.id % 3)
from (values
  ('demo-collector@demo.local', 400),
  ('demo-player@demo.local',    120),
  ('demo-banned@demo.local',     18)
) as v(email, entries)
join auth.users u on u.email = v.email
join lateral (
  select c.id from public.cards c
  where c.deleted_at is null and c.legal_commander = 'legal'
  order by c.id
  limit v.entries
) c on true
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What you just got
-- ---------------------------------------------------------------------------
commit;

\echo ''
\echo 'Demo cast for /admin:'
select
  u.email,
  p.display_name,
  (a.user_id is not null) as is_admin,
  (u.banned_until > now()) as banned,
  (select count(*) from public.decks d where d.user_id = u.id) as decks,
  (select count(*) from public.collection_items ci where ci.user_id = u.id) as collection
from auth.users u
left join public.profiles p on p.id = u.id
left join public.platform_admins a on a.user_id = u.id
where u.email like '%@demo.local' or u.email like '%@test.local'
order by (a.user_id is null), u.email;

\echo ''
\echo 'Sign in and open the admin area:'
\echo '  yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts admin /admin'
\echo ''
