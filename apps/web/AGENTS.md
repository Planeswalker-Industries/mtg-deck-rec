# AGENTS.md — apps/web

Web-app-specific guidance. Full architecture, data pipeline, and commands: `../../CLAUDE.md`.

## Next.js 16.3

This app targets Next.js 16.3. APIs differ from older versions. Read the bundled docs in `node_modules/next/dist/docs/` before writing Next code.

- `cacheComponents: true` — uncached or request-time reads must sit inside `<Suspense>`
- Pair every `use cache` with `cacheLife`
- `revalidateTag` takes a second (profile) argument
- `proxy.ts` replaces `middleware.ts`
- `app/layout.tsx` is the root layout

## Server Component Patterns

- Public reads: Server Components with `use cache` (must SSR and stay indexable)
- Recommendations: Route Handlers `POST /api/recs/{swap,add,cut}` (Server Actions dispatch serially)
- Deck parsing, analysis, link import, deck lookups: Server Actions
- Client code reaches the contract only through `lib/api/client.ts` (`getApis()`)

## Admin Area (`/admin` — React Admin)

The one part of the app not built on the contract or on shadcn.

### Routing

- `admin-app.tsx` wraps `<Admin>` in `<BrowserRouter basename="/admin">`
- The basename goes on the router **and nowhere else** — `<Admin basename>` prefixes every link twice
- `/admin` and `/admin/[...slug]` are two files (second re-exports first); typed routes derive literals from the folder

### Layout

- `components/admin/admin-layout.tsx` replaces React Admin's `<Layout>`: its `<main>` would be a second main landmark, and its fixed app bar covers the site header
- `userMenu={false}`: the site header's account control is twenty pixels above

### Theme

- `components/admin/theme.ts` restates the site's tokens as a Material UI theme
- Values mirror `:root` in `globals.css` — **literals, not `var(--token)`** (Material UI does colour maths on palette entries)
- Gold marks active nav, sorted column, Admin pill, one contained button — nothing else
- `MuiPaper.backgroundImage` cleared (Material's dark mode gradient fights the `lit` recipe)

### Data flow

- React Admin talks to `/api/admin/{users,tags,sync-runs}`, never to Supabase directly (`components/admin/data-provider.ts`, one `ResourceApi` per resource)
- Every admin read/write is a security-definer function that checks the caller
- `platform-admins` endpoint has the admins-only filter pinned on

### Key gotchas

- `min-width: 0` on the datagrid is load-bearing — without it the flex item pushes the page wider than a phone
- Admin + banned are one **Status** column of pills, not two tick columns
- Emails render as plain text in lists, `mailto:` only on the Show screen
- A signed-in non-admin gets **404, not 403** from both the page and the API
- The only link to `/admin` is on `/account`, shown to admins only

## Coding Policy

**Never use Magic Numbers in the code. Set as top of document const variables if used in ONLY that document/component. Otherwise, set in a global constants/config file and import.** (Owner rule, 2026-09-21.)
- Name the constant for what it means and put the unit in the name (`SWIPE_COOLDOWN_MS`, `DRAG_CLICK_SLOP_PX`), with a one-line comment on why it has that value.
- A value shared across files goes in `apps/web/src/lib/constants.ts` for the web app, or `packages/core/src` when the worker needs it too. Create the file when the first shared value needs it.
- Not magic numbers: 0, 1 and -1 used as identities or directions, array indices, and Tailwind classes or design tokens (`gap-3`, `size-14`), which already are the scale.
- Scoring weights and anti-abuse thresholds still belong in database config (`app_config`), not in a constants file: the repo is public (see Hard constraints in `../../CLAUDE.md`).

## UI Patterns

- **shadcn/ui** (`radix-nova` style, Radix primitives)
- `cn` from the `cn` package (pinned exact version)
- **PocketGrid** uses `@container` (`@md:`/`@xl:`/`@3xl:`), not viewport breakpoints — columns answer to the container, not the viewport
- Card images: `unoptimized`, hotlinked from Scryfall CDN via `components/cards/card-image.tsx`. Never overlay badges or UI on the lower part — Scryfall requires the artist/copyright line visible
- `components/layout/ad-slot.tsx` marks future ad positions, renders nothing until enabled

## Key Files

| File | Purpose |
|---|---|
| `components/deck/use-deck-tool.ts` | Request flow, stale responses dropped by request counters |
| `components/deck/deck-tool.tsx` | Workspace layout (grid, drill-down, rail) |
| `lib/api/client.ts` | `getApis()` — contract access |
| `lib/server/recs-cache.ts` | Swap caching (`use cache` + `cacheLife("hours")`) |
| `lib/server/share-import.ts` | `fetchShareLink`, kill switch |
| `lib/server/retry-timeout.ts` | Statement-timeout retry (SQLSTATE 57014) |
| `lib/saved-deck.ts` | Browser-only remembered deck (localStorage, 30 days) |
| `lib/safe-path.ts` | `safeNextPath` redirect validation |
| `components/admin/theme.ts` | Material UI theme mirroring site tokens |
| `components/admin/data-provider.ts` | React Admin data layer |

## Gotchas

- `/deck` is `noindex` — indexable content belongs on card/commander pages
- `/decks` redirects signed-out visitors to `/sign-in?next=/decks`
- `/decks/[commander]/[code]` — the 12-char code alone resolves the deck; the commander segment is decoration
- `proxy.ts`: signed-out visitors get `notFound` for `/decks/:commander/:code` (anon can't distinguish private from missing)
- Production builds need reachable Supabase — `next build` prerenders `/sitemap.xml` which queries the DB
- `supabase gen types typescript --local` outputs UTF-8 with BOM and CRLF via PowerShell; write as UTF-8 without BOM, LF endings
- `revalidatePath('/decks')` on deck writes; `revalidateTag` on syncs — keep `next/cache` imports out of `recs.ts` so the regression harness can run outside Next.js
- The deck tool's `SaveDeckButton` is the only way to create a deck — never auto-save a throwaway paste as public

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
