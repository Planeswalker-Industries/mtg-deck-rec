# AGENTS.md — apps/web

Web-app detail: Next.js patterns, pages, UI, the admin area and web gotchas.

*Each fact lives in one doc; others link to it. When code and docs disagree, the code wins and the doc is fixed.* Repo-wide rules are in [`../../CLAUDE.md`](../../CLAUDE.md).

## Next.js 16.3

This app targets Next.js 16.3. APIs differ from older versions. Read the bundled docs in `node_modules/next/dist/docs/` before writing Next code.

- `cacheComponents: true`: uncached or request-time reads (including `useSearchParams` and `params`) must sit inside `<Suspense>`
- Pair every `use cache` with `cacheLife`
- `revalidateTag` takes a second (profile) argument
- `proxy.ts` replaces `middleware.ts`
- Route segment config `dynamic` does not exist under `cacheComponents`: `export const dynamic = "force-dynamic"` is a build error that only `build` catches (type-check and lint pass). Everything is dynamic by default. `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` lists the segment configs that went away
- `notFound()` or `redirect()` inside a `<Suspense>` runs after the shell has streamed: `notFound()` answers HTTP 200 and `redirect()` strands the visitor on a loading page. Anything that must be a real 404 or redirect happens in `proxy.ts`

## UI

- **Design direction "Kitchen Table"** (2026-09-29, replacing "Table at night"): a friend's kitchen table on game night meets a well-thumbed trade binder. The app should feel like an experienced friend sifting your cards with you, not a statistics engine. Mobile-first is the top priority, and every card shown must show its image. Dark only (a light theme is shelved)
  - Tokens live in `src/app/globals.css`: walnut `--background`, oak `--sleeve` for panels, warm-paper `--foreground`, and `--primary` (sleeve blue) as the one accent, on actions, links, focus and the selected state only. `--cut`, `--add` and `--replace` name the three jobs and always come with an icon and a label. The previous palettes are kept as `--*v3`, `--*v2` and `--*v1`
  - Fonts: Bricolage Grotesque for headings and UI (only 400 and 600 are loaded, so `font-normal` and `font-semibold` are the only weights), Newsreader Italic (`font-drama`) for the buddy's voice and quoted speech only (the headline phrase, asides, the "Sound familiar?" cards), never for UI labels, and DM Mono (`font-mono`) for standalone numbers (counts, prices, play rates, stat tiles) and eyebrows. A sentence that contains numbers stays in the body font with `tabular-nums`. DM Mono loads 400 only, so never pair it with `font-semibold`
  - The type scale is `text-xs` to `text-4xl` = 12 / 14 / 16 / 18 / 24 / 32 / 44 / 60 px, redefined in `@theme`; no arbitrary `text-[…]` sizes. Radius: `rounded-lg` (8 px) for controls, `rounded-panel` (14 px) for panels. Only cards being handled cast a shadow (`shadow-lift`); the grain is a body background, so it never covers panels or card art. Touch targets are at least 44 px on phones: `Button` draws an invisible 44 px `::after` below `sm` (`PHONE_HIT_AREA`), `lg` buttons are 44 px tall there, and compact custom controls use the same `::after` trick rather than growing
  - **Blue means you can press it, and everything you can press shows blue.** One treatment per kind of control: the primary action is a blue fill, a secondary action a hairline outline, every text link `TEXT_LINK` (`lib/constants.ts`: blue, underlined; footer and credits included), nav items muted with a blue underline for the current page, pressable surfaces (the "Sound familiar?" cells, commander tiles) turn over to or edge in blue on hover and focus, icon-only buttons (and ghost buttons) grey at rest and blue on hover and focus (delete turns red instead), and pressable card images a blue focus ring and a slight lift on hover, never blue on the card itself. Static panels carry no blue
  - The signature is "the pass": a card slid onto the hand (the hero fan's passed card, `.pass-card` in `globals.css`). A one-line aside in `font-drama` may go with it where the page is about that card; the hero has none
- **Page width:** every page, header and footer sits in `page-column` (`globals.css`): the margins beside it are half what a fixed 72rem column would leave. Anything that must reach from the column to the window edge reads `--page-column`
- Card images: `unoptimized`, hotlinked from Scryfall via `components/cards/card-image.tsx`. Never overlay badges or UI on the lower part: Scryfall requires the artist/copyright line visible
- **Pick the image `variant` from the size it renders at.** `unoptimized` means no srcset, so the browser fetches whatever `variant` names, whole: `small` 146×204 (~13 KB), `normal` 488×680 (~93 KB), `large` 672×936. **Every grid of cards is `small`**, up to `PocketGrid`'s 160 px pockets; `normal` is for a card shown alone at a few hundred pixels; `large` for one deliberately enlarged
- **`/deck` on a phone is budgeted for the swipe view.** `DeckBar` is two lines (deck name, colours, card count or Upgrade coverage and an Edit decklist pencil; bracket and collection selects on the right). Deck issues are a warning chip beside the name that opens a bottom sheet (`DeckIssuesChip`), on every screen width; the collapsed issue list (`ResolutionIssues`) is only for pages without the bar. Swipe or list is one icon beside the steps (`ViewToggle`); the labelled control is for wider screens. Game Changers follow the bracket (`defaultIncludeGameChangers`) with no control of their own. In Swipe view each phase's heading and its one-line hint (`PhaseIntro` `brief`) are screen-reader only: ✓ and ✕ say what the gestures do. The swipe cards size themselves from `100lvh` (not `dvh`, which grows as the address bar hides on scroll and made the cards grow) minus what surrounds them (`--swipe-chrome`), so re-measure at 390×844 after adding anything above them: ✓ and ✕ must stay on screen without scrolling. Below `lg` the Deck stats footer docks at the bottom (below `xl` in the Deckbuilder). The page reserves its height under everything, the site footer included (`body:has([data-deck-stats-dock])` in `globals.css`, from `--deck-stats-dock-height`); the host sets `--deck-stats-dock` (that height plus the safe area, 0 where the rail shows), which `SingleSwipe` and `ReplacePhase` subtract from the card's height, the sticky Next and bracket-check bars sit above, and the Deckbuilder's scrolling halves leave out; re-measure at 390×844 after changing the footer
- `DeckBar` publishes its own height to `--deck-bar-height` (`DECK_BAR_HEIGHT_VAR`, `lib/constants.ts`); sticky surfaces below it offset by `var(--deck-bar-height,0px)`

## Key files

| File | Purpose |
|---|---|
| `components/deck/use-deck-tool.ts` | Request flow, stale responses dropped by request counters |
| `components/deck/deck-tool.tsx` | Upgrade (journey) and Deckbuilder modes |
| `components/deck/journey/use-deck-journey.ts` | Cut → Add → Replace → Review round over `@mtg/core/journey`; one component per phase beside it |
| `components/deckbuilder/deck-builder.tsx` | The deckbuilder; hosted by `saved-deck-editor.tsx` and `tool-deck-editor.tsx` |
| `components/collection/collection-tool.tsx` | Collection import: paste, file or share link, then match and save |
| `lib/api/client.ts` | `getApis()`, contract access |
| `lib/server/recs.ts`, `recs-route.ts`, `recs-cache.ts` | Recommendation pipeline, route handler wrapper, swap caching |
| `lib/server/serving.ts` | The serving reads (T055): one round per add, cut and swap; `serving_card` rows to card rows and play rates |
| `lib/server/config-cache.ts` | Settings cached per server instance for a minute |
| `lib/server/collection-availability.ts` | Functional twin groups (cached), a request's `Availability`, stand-in rows |
| `lib/server/brackets.ts` | `app_config.brackets` and the cards the bracket rules watch, cached |
| `lib/server/scoring-config.ts` | `app_config.scoring`, read with the secret key |
| `lib/server/retry-timeout.ts` | Statement-timeout retry (SQLSTATE 57014) for the card tags' Postgres fallback |
| `lib/server/search-index.ts` | `fromIndex`: index first, Postgres fallback |
| `lib/server/share-import.ts` | `fetchShareLink`, kill switch |
| `lib/server/collection-link.ts` | Archidekt collection export, paged |
| `lib/server/crawl-cron.ts` | Daily deck-crawl trigger: `CRON_SECRET` gate, forwards to the search API |
| `lib/server/deck-export.ts`, `components/decks/deck-export.tsx` | Deck page export |
| `lib/saved-deck.ts` | Browser-only remembered deck |
| `lib/safe-path.ts` | `safeNextPath` redirect validation |
| `lib/constants.ts` | Values shared across files |
| `components/admin/data-provider.ts`, `theme.ts`, `tags.tsx`, `sync-runs.tsx` | React Admin data layer, theme and screens |

## Where to read

| Read | When |
|---|---|
| [`docs/reference/web-platform.md`](../../docs/reference/web-platform.md) | Transport and data access, caching, routing, 404s, indexing, Vercel |
| [`docs/reference/web-deck-tool.md`](../../docs/reference/web-deck-tool.md) | The deck tool (`/deck`), saved decks in the app, the deckbuilder |
| [`docs/reference/web-collections.md`](../../docs/reference/web-collections.md) | Collections and accounts in the app |
| [`docs/reference/web-admin.md`](../../docs/reference/web-admin.md) | The `/admin` area |
| [`docs/reference/web-ui.md`](../../docs/reference/web-ui.md) | Shared surfaces, shadcn/ui, PocketGrid, search-as-you-type, `LoadedFile`, ad slot |
| [`docs/reference/testing.md`](../../docs/reference/testing.md) | Check scripts, e2e, regression fixtures |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
