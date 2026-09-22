-- "Owned first": suggestions come from every card, and an owned card sorts as if it scored firstBoost higher (the
-- score shown stays its own). Measured 2026-09-22 locally, Liesa with a two-card deck: the top eight creatures to add
-- scored 0.78 to 0.87, so at 0.1 owned cards lead nearly every top suggestion while still following their own
-- scores among themselves. Lower it if "first" should only break near-ties. Public, like the corpus settings, because the web app reads it with the anon role.
insert into public.app_config (key, value, is_public)
values ('ownership', '{"firstBoost": 0.1}'::jsonb, true)
on conflict (key) do nothing;
