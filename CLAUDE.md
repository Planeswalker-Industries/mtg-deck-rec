# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

*Each fact lives in one doc; others link to it. When code and docs disagree, the code wins and the doc is fixed.*

## Project

mtg-deck-rec: public Commander-only web app. Paste or import a decklist → cards to add, cards to cut, and functional substitutes (click a card) with an estimated cost delta. Two modes share one pipeline: **collection-less** (anonymous; ranked by corpus play rate + Scryfall Tagger tags) and **collection-aware** (the player's collection filters or reorders the candidate pool).

Live at https://mtg-app-psi.vercel.app (Vercel + Supabase Pro + a VPS for the search index and deck crawls). Current state: `docs/roadmap/status.md`. Open work: `docs/tasks.md`. The UI overhaul is tracked in `docs/ui-overhaul/` (start at `STATE.md`; it supersedes the "UI order" in `docs/tasks.md`).

The GitHub repo is `Planeswalker-Industries/mtg-deck-rec`, a shared organisation repo (moved from `wuddat/mtg-deck-rec`, which redirects). User-Agent strings, in-app links and the search API's Go module path use the organisation address.

**Branches:** `develop` is the working branch. Start every branch from `develop` and merge it back into `develop` (PRs with `--base develop`); `main` is merged from `develop` manually, and it's what Vercel production and the Supabase GitHub integration deploy.

## Never miss

- Writes touch only the rows that change: diff, never delete-and-reinsert (`docs/reference/database.md`).
- Every migration grants explicitly to the API roles, besides RLS (`docs/reference/database.md`).
- Never test account deletion, locally or hosted (`docs/reference/accounts-collections.md`).
- Third-party decklists and EDHREC's numbers are never shown to visitors (Hard constraints, below).
- A contract change bumps `CONTRACT_VERSION` and needs frontend and backend approval (Architecture, below).

## Where to read

| Read | When |
|---|---|
| [`docs/ui-overhaul/STATE.md`](docs/ui-overhaul/STATE.md) | Current UI overhaul state and next action |
| [`docs/reference/data-pipeline.md`](docs/reference/data-pipeline.md) | Before touching the collator, the precompute worker or the worker CLI |
| [`docs/reference/database.md`](docs/reference/database.md) | Before any SQL, migration or sync job |
| [`docs/reference/recommendations.md`](docs/reference/recommendations.md) | Before changing scoring, play rates, corpus rules or combos |
| [`docs/reference/sources-and-crawls.md`](docs/reference/sources-and-crawls.md) | Before touching the deck crawl, EDHREC or Archidekt access |
| [`docs/reference/search-index.md`](docs/reference/search-index.md) | Before touching Typesense or the search API |
| [`docs/reference/accounts-collections.md`](docs/reference/accounts-collections.md) | Before touching accounts, saved decks, collections, votes, events or admins in the database |
| [`docs/reference/testing.md`](docs/reference/testing.md) | Before running SQL checks, e2e, regression fixtures or check scripts |
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | Any web-app work (it links the `docs/reference/web-*.md` files) |
| [`docs/tasks.md`](docs/tasks.md), [`docs/roadmap/status.md`](docs/roadmap/status.md) | Open work and current state |

## Commands

Yarn 4 workspaces (`nodeLinker: node-modules`), Node ≥ 24.

```sh
yarn install
yarn dev                                         # apps/web on http://localhost:3000 (local Supabase data; NEXT_PUBLIC_USE_MOCKS=1 for mocks)
yarn typecheck | yarn lint | yarn test | yarn build   # all workspaces
yarn workspace @mtg/web typecheck                # next typegen + tsc (typegen creates LayoutProps/PageProps globals)
yarn workspace @mtg/core vitest run src/contract/mocks/mocks.test.ts   # single test file
yarn workspace @mtg/core vitest run -t "swap"                          # tests matching a name

supabase start                                   # local Supabase: API 56321, Postgres 56322, Studio 56323 (own port range; other local stacks use the defaults)
supabase db reset                                # re-apply supabase/migrations from scratch
supabase migration up                            # apply new migrations to the running local database
supabase gen types typescript --local            # regenerate apps/web/src/lib/server/database.types.ts after schema changes (write UTF-8 without BOM, LF line endings; PowerShell's Out-String adds CRLF)
```

psql isn't installed locally; query the database with `docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres`.

TypeScript is pinned to 6.0.x on purpose: TS 7 (native) doesn't ship the JS compiler API, which typescript-eslint (via eslint-config-next) needs.

## Architecture

- `packages/core/src/contract/` is the **frontend/backend contract** and the source of truth for API shapes. Frontend builds against `createMockApis()` (`@mtg/core/mocks`); backend implements the same `RecsApi` / `ActionsApi` / `DataApi` interfaces. Change the contract via PR only; every change needs approval from both frontend and backend and bumps `CONTRACT_VERSION` (`contract/version.ts`, with a changelog comment per version).
- Core modules besides the contract: `formats/commander/` (color identity, partner pairs, bracket estimate, deck validation), `parse/` (decklists, CSV, name normalization, Archidekt decks, EDHREC pages), `scoring/` (corpus, swap, add and cut scoring, shared with the regression harness), `journey/` (deck journey and deckbuilder reducers), `collection/` (filter and edit rules), `search/` (search-index document shapes).
- `apps/web` is Next.js 16.3 (Vercel). Transport, caching, UI and admin rules are in `apps/web/AGENTS.md`.
- `apps/worker` is a tsx CLI outside Next.js for syncs, aggregates and imports.
- `services/search-api` is a Go (Fiber) service on the VPS: the only client of Typesense, and the host of the deck crawl.

## Local data

The repo assumes no particular disk. Large local data (Scryfall bulk downloads, regression fixtures, screenshots) goes under the folder `MTG_DATA_DIR` names; unset, the worker uses a folder in the system temp directory. Whatever is particular to one machine (its disks, its tool scripts, where Docker keeps its data) belongs in `CLAUDE.local.md`, which is gitignored and read alongside this file.

## Domain conventions

- `CardId` is an int surrogate 1:1 with Scryfall `oracle_id`. Decks and recommendations are oracle-level; collections are printing-level (`PrintingId` = Scryfall card id).
- Tagger tags are keyed by their **UUID**, never slug/label. Bulk data holds only direct taggings; parent tags are reached through the hierarchy.
- Prices are estimates and must always render with their as-of timestamp.
- Scryfall `edhrec_rank` is not used anywhere.

## Coding policy

**Never use Magic Numbers in the code. Set as top of document const variables if used in ONLY that document/component. Otherwise, set in a global constants/config file and import.** (Owner rule, 2026-09-21.)

- Name the constant for what it means and put the unit in the name (`SWIPE_COOLDOWN_MS`, `DRAG_CLICK_SLOP_PX`), with a one-line comment on why it has that value.
- A value shared across files goes in `apps/web/src/lib/constants.ts` for the web app, or `packages/core/src` when the worker needs it too. Add to those rather than starting another.
- Not magic numbers: 0, 1 and -1 used as identities or directions, array indices, and Tailwind classes or design tokens (`gap-3`, `size-14`), which already are the scale.
- Scoring weights and anti-abuse thresholds belong in database config (`app_config`), not in a constants file: the repo is public.

## Hard constraints

- **No bot-detection circumvention** unless the owner explicitly authorizes it: no cloudscraper-class libraries, fingerprint spoofing, UA rotation, proxies or challenge solvers. Every outbound request sends an accurate descriptive `User-Agent` (and `Accept` for Scryfall).
- **Data sources:** the owner's legal team consented (2026-09-21, reaffirmed) to using **all publicly facing data** (no paywall, no login) from every platform, EDHREC and MTGGoldfish included. Consent covers what may be used, not how it is fetched: obey robots.txt, one limiter per host at about one request a second (slower if the host asks, as Archidekt's 429s did), an honest User-Agent, and a 403 or bot challenge switches that source off and is reported to the owner rather than worked around.
  - **Archidekt:** active. Staff allowed the project's API reads (2026-09-14); robots.txt permits `/api/`.
  - **EDHREC:** commander pages as JSON, fetched by `sync:edhrec` (first loaded 2026-09-28, T035 slice 11). Individual decklists (`/deckpreview/`) are disallowed by robots.txt and never fetched.
  - **Moxfield:** off. It answered Cloudflare's hard WAF block on a robots.txt-allowed path (2026-09-22) and stays off until it grants an accessible path.
  - **MTGGoldfish:** allowed, not started; its deck downloads are disallowed by robots.txt.
  - **Commander Spellbook:** active (2026-10-04, `sync:spellbook`). Only its published export on `json.commanderspellbook.com` is fetched, once a day. robots.txt allows everything on `commanderspellbook.com` and disallows everything on `backend.commanderspellbook.com` (its API), which is never called. The site links no terms of use (checked 2026-10-04).
- **Share-link imports** are allowed (owner decision, 2026-09-14): a deck or collection link a user pastes may be fetched, since those links exist to move lists between platforms. One request per user action, honest User-Agent, and on a block show the paste-text fallback; never work around it. The one exception is a large Archidekt collection, whose export is paged: up to 20 requests a second apart, four per server call.
- **Third-party decklists are used for aggregates only and never exposed to visitors.** The one exception is `/admin/crawls` (owner decision, 2026-09-24), which shows a platform admin the crawled corpus, because only the cards prove the adapter read the deck. It is `noindex`, `no-store`, behind the same three locks as the rest of `/admin`, and reads the raw deck schemas through `admin_*` security-definer functions; none of the private schemas is on PostgREST's exposed list. EDHREC's numbers are likewise never displayed.
- **The repo is public:** anti-abuse thresholds and scoring weights belong in database config, not code.
