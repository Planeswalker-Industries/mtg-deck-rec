# Web admin area

The `/admin` area (React Admin). Back to [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) and [`CLAUDE.md`](../../CLAUDE.md).

## Admin area (`/admin` — React Admin)

The one part of the app not built on the contract or on shadcn. Three locks: `proxy.ts`, the page, and each `/api/admin/*` route; every read and write behind them is a security-definer function (see `../../CLAUDE.md`).

### Routing

- `admin-app.tsx` wraps `<Admin>` in `<BrowserRouter basename="/admin">`
- The basename goes on the router **and nowhere else**: `<Admin basename>` prefixes every link twice
- `/admin` and `/admin/[...slug]` are two files (second re-exports first); typed routes derive literals from the folder

### Layout and theme

- `components/admin/admin-layout.tsx` replaces React Admin's `<Layout>`: its `<main>` would be a second main landmark, and its fixed app bar covers the site header. `userMenu={false}`: the site header's account control is right above
- `components/admin/theme.ts` restates the site's tokens as a Material UI theme, as **literals, not `var(--token)`** (Material UI does colour maths on palette entries)
- The accent marks active nav, sorted column, Admin pill, one contained button — nothing else
- `MuiPaper.backgroundImage` cleared (Material's dark mode gradient fights the `lit` recipe)

### Data flow

- Resources: Users, Platform admins (users with the admins-only filter pinned), Tags (the kill switch, `tags.tsx`), Sync runs (read-only history, `sync-runs.tsx`) and Accept rate (`accept-rates.tsx`: shown, taken, passed on and accept rate per list and place, filtered by list and a 7, 30 or 90-day window; T065)
- React Admin talks to `/api/admin/{users,tags,sync-runs,accept-rates}`, never to Supabase directly (`components/admin/data-provider.ts`, one `ResourceApi` per resource)
- Tags: the API route revalidates `recs` and `catalog` only when the switch actually flips. Recommendations change at once; the search index's tags collection picks it up at its next drain
- Sync runs: each job's latest run above the history, filterable by job and status; the filter lists in `lib/admin/types.ts` are checked against the database enums at compile time in `lib/server/admin.ts`
- Status pills come from `components/admin/pill.tsx` (`Pill`, `Pills`); tones are the site's job colours plus the accent
- A new admin endpoint goes in `ADMIN_API` in `e2e/admin.spec.ts`, which checks every one refuses signed-out visitors (401) and non-admins (404)

### Gotchas

- `min-width: 0` on the datagrid is load-bearing: without it the flex item pushes the page wider than a phone
- Admin + banned are one **Status** column of pills, not two tick columns
- Emails render as plain text in lists, `mailto:` only on the Show screen
- A signed-in non-admin gets **404, not 403** from both the page and the API
- **`/admin/crawls` is not a React Admin resource.** It is a static segment, so it wins over `/admin/[...slug]`, and it is built in the site's own shadcn and tokens because it is read rather than administered. It shows source cards (deck count, last run, a pulse while a claim is held, the disabled reason) and the crawled decks, each expanding to its card list on first open. It inherits the proxy gate, checks `requirePlatformAdmin` itself, and its two `/api/admin/crawls*` routes check again. The sidebar link hands the click to Next's router, since react-router knows nothing about that page. It is the one place third-party decklists are rendered (see Hard constraints in `../../CLAUDE.md`)
