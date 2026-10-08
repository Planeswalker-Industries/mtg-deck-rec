# AGENTS.md — apps/web

Web-app detail: Next.js patterns, pages, UI, the admin area and web gotchas.

> **Keep the four project docs in step.** Repo-wide rules (architecture, data pipeline, database, hard constraints, coding policy) are in [`../../CLAUDE.md`](../../CLAUDE.md); open work is [`../../docs/tasks.md`](../../docs/tasks.md); current state is [`../../docs/roadmap/status.md`](../../docs/roadmap/status.md). Any change to this file is checked against those three in the same edit. Each fact lives in one of them only; the others link to it.

## Next.js 16.3

This app targets Next.js 16.3. APIs differ from older versions. Read the bundled docs in `node_modules/next/dist/docs/` before writing Next code.

- `cacheComponents: true`: uncached or request-time reads (including `useSearchParams` and `params`) must sit inside `<Suspense>`
- Pair every `use cache` with `cacheLife`
- `revalidateTag` takes a second (profile) argument
- `proxy.ts` replaces `middleware.ts`
- Route segment config `dynamic` does not exist under `cacheComponents`: `export const dynamic = "force-dynamic"` is a build error that only `build` catches (type-check and lint pass). Everything is dynamic by default. `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md` lists the segment configs that went away
- `notFound()` or `redirect()` inside a `<Suspense>` runs after the shell has streamed: `notFound()` answers HTTP 200 and `redirect()` strands the visitor on a loading page. Anything that must be a real 404 or redirect happens in `proxy.ts`

## Transport and data access

- Public reads: Server Components with `use cache` (pages must SSR and stay indexable)
- Recommendations: Route Handlers `POST /api/recs/{swap,add,cut,build}`, because Server Actions dispatch serially. They share `handleRecsRequest` (`lib/server/recs-route.ts`): rate limit, validate, read the collection (a browser's from the request; an account's copies and built decks through `my_card_availability`), run, map errors to status codes (429 with `Retry-After`). The rate limit goes out with the request's reads, not ahead of them (the rater's action does the same): a request over budget drops what it read, and the instance then answers that visitor without the database until the budget renews (`knownRateLimit`, `lib/server/rate-limit.ts`, which every `checkRateLimit` caller gets)
- Deck parsing, analysis, link import, deck lookups, votes, accept-rate events: Server Actions (`begin(bucket)` in `app/deck/actions.ts`)
- Client code reaches the contract only through `lib/api/client.ts` (`getApis()`): the real actions and routes, or the mocks with `NEXT_PUBLIC_USE_MOCKS=1` (CI builds that way, since its database has no catalog)
- A few account-side actions sit outside the contract and are imported directly: `getAccountCollectionAction` and `importCollectionFromLinkAction` (`app/collection/actions.ts`), plus sign-in and account deletion. They bypass the mocks, so CI tests must not trigger them against real services (the collection link e2e only uses a ManaBox link, which answers before any request)
- Route handlers beside pages are fine when a page needs a download: `/decks/[commander]/[code]/export` reuses `loadDeckPage`, so the same people can see the page and fetch the file
- Scheduled work is a route the platform calls: `/api/cron/{archidekt,moxfield}-scrape` (`lib/server/crawl-cron.ts`) forwards a daily Vercel cron to the search API's deck crawl. A cron route is authorized by `CRON_SECRET` (Vercel sends `Authorization: Bearer $CRON_SECRET`), never by `x-vercel-cron-schedule` or the user agent; unset `CRON_SECRET` is 503
- **Keep `next/cache` imports out of `lib/server/recs.ts` and `serving.ts`**, so `yarn workspace @mtg/web regress` can run the recommendation code outside Next.js
- **Recommendations read the precompute worker's tables (T055, `lib/server/serving.ts`).** Add, cut and swap each send every read at once, then rank (add and cut also read the deck's combos, `serving_deck_combos`, and every recommendation and deck analysis the cached bracket rules and watched cards, `lib/server/brackets.ts`; T060): `loadServedAdds`, `loadServedCuts` and `loadServedSwapPool` call the `serving_*` functions, which return each card whole so no read waits on another's ids (`../../CLAUDE.md`, "Precompute worker"), beside the commander's corpus (`loadCommanderCorpus`: the keys with their stats embedded, and EDHREC's role and curve profile through `serving_commander_profile`, read together). Adds also read the deck's own cards (`fetchCardsById`) for its curve (T062), and adds, cuts and swaps its card pairs (`serving_deck_affinity`, T064; a swap reads them beside its cached pool, since they depend on the deck). A build (T063, `getBuild`) reads `loadServedBuild` (`serving_build_pool`) beside the corpus and the kept cards in one round, after an account collection like the rest. The rater and commander pages use `loadServedDeckPool` and `loadServedCards`; card alternatives use the swap pool. An account collection is read before the request, since its cards filter or rank the pool, so those requests take one round more. In 'only' mode the add and swap reads also fetch the pool everyone gets, for the buy list, and the rows of owned cards that may stand in for a twin (`lib/server/collection-availability.ts`), in the same round
- **The search index is read first, Postgres is the fallback** (`fromIndex`, `lib/server/search-index.ts`): `searchCards`, `fetchCardsById`, `fetchCardTags`, `loadTopCardIds`, and `pageExists` in `proxy.ts`. Recommendation card rows come from Postgres with their scores instead, which saves a round. Search stays server-side behind `/api/cards/search` (rate-limit bucket `search`); `x-search-source` names which side answered (`index`, `index-filtered`, `postgres-filtered`, `postgres-unconfigured`, `postgres-index-failed`)

## Caching

- **Settings:** the corpus settings and whether a corpus exists, decks per month per colour identity, role targets and their tags, the owned-first boost and the scoring weights are cached per server instance for a minute (`cachedConfig`, `lib/server/config-cache.ts`), so a request doesn't read them first. The scoring weights (`app_config.scoring`) are private: `loadScoringConfig` (`lib/server/scoring-config.ts`) reads them with `SUPABASE_SECRET_KEY`, so every environment that serves recommendations needs that key, and the result never reaches client code. An admin change shows within a minute; a failed load isn't kept, so the next request tries again
- **Swap suggestions:** `loadSwapPool` (candidates, card rows, tags, play rates, from the serving tables) doesn't depend on the rest of the deck; `rankSwaps` removes the deck's own cards and blends scores. The swap route calls `getCachedSwapSuggestions` (`lib/server/recs-cache.ts`: `use cache`, `cacheLife("hours")`, tag `recs`), keyed by target, commander ids and the Game Changer setting. Owned-only requests read their own pool uncached, with the cached shared pool beside it for the buy list; owned-first shares the cache
- **Commander pages:** `loadCommanderPage` is wrapped by `getCommanderPage` (`cacheLife("days")`, tag `corpus`). Cards are ranked by `commanderCorpusScore` over the same release-aware rates as the deck tool, and banned cards are skipped. A page reads its top 500 from `commander_card_stats` by index; one that borrows partner decks takes them from its stored pool (`serving_add_pool`: `commander_card_scores`, or `commander_pair_pool` for a derived pair, T070)
- **Card pages:** `loadCardPage` is wrapped by `getCardPage` (`cacheLife("days")`, tags `catalog` and `corpus`). Functional tags come through `card_functional_tags` (API roles can't read the `functional_tags` view). Alternatives are a swap pool limited to the card's own colour identity (`loadSwapPool` `identityMask`), ranked with no deck. "Commanders whose decks run it most" uses `card_top_commanders`
- Revalidation: the worker posts tags to `/api/internal/revalidate` after syncs; deck writes call `revalidatePath('/decks')`; an admin flipping a tag revalidates `recs` and `catalog`; a finished deck lookup calls `updateTag("corpus")` and `updateTag("recs")`

## Routing, 404s and indexing

- **Real 404s:** `src/proxy.ts` (matcher `/card/:slug`, `/commander/:slug`) checks the card (live row) or commander key exists and rewrites missing slugs to `/_missing`, a path with no route, because Vercel serves the prerendered `/_not-found` with status 200. Keep the check a superset of what the page loaders need, so it never 404s a page that would render; database errors fall through to the page. RSC navigation payloads for a missing slug return 404 in dev but 200 in production; the browser shows the not-found page either way.
- **`/decks/:commander/:code` goes through `proxy.ts` only for signed-out visitors**: the anon client can't tell a private deck from a missing one, so a stranger gets a real 404; a request with a session cookie falls through to the page. `/decks/[commander]/[code]/edit` sends signed-out visitors to sign in there too
- The commander segment in `/decks/[commander]/[code]` is decoration: the code alone resolves the deck, and a stale segment is deliberately not redirected (the page is noindex, so duplicate paths cost nothing)
- `proxy.ts` refreshes the auth session only when an `sb-*-auth-token` cookie is present. Redirect targets go through `safeNextPath` (`lib/safe-path.ts`)
- `noindex`: `/deck`, `/decks`, `/decks/[commander]/[code]` (and its edit page), `/admin`. Indexable content belongs on card and commander pages. Whether public deck pages get indexed is T028
- `/decks` redirects signed-out visitors to `/sign-in?next=/decks`
- **Sitemap:** `app/sitemap.ts` lists the home page, commander pages with decks, and every card not marked not_legal, through the `sitemap_slugs` jsonb function (one value, so PostgREST's row cap doesn't apply; index-only on `cards_sitemap_slugs`). It calls `connection()` first so `next build` never runs that query: keep build-time prerendering away from queries that grow with the catalog. `app/robots.ts` disallows `/api/`. Absolute URLs come from `NEXT_PUBLIC_SITE_URL` (`lib/site.ts`), also `metadataBase`

## Vercel

- Project `mtg-app`, root `apps/web`, functions in `cle1` (`vercel.json`) next to the Supabase database in `us-east-2`; `iad1` round trips made card pages take seconds
- Production builds need a reachable Supabase: `next build` prerenders `/sitemap.xml`, so a build without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` fails with "Supabase isn't configured". Vercel needs them for Preview as well as Production
- Vercel overwrites `x-forwarded-for` with the caller's address, so e2e checks can't fake separate visitors there
- A preview of `develop` runs against `main`'s database schema (see Hosting in `../../CLAUDE.md`)

## Features

### Deck tool (`/deck`)

- **Upgrade mode (deck journey, contract v11)** is a guided round of Cut → Add → Replace → Review (on screen: Cut, Add, Swap, Done); the other mode is the Deckbuilder. The round's state is a pure reducer in `@mtg/core/journey` (tested), driven by `components/deck/journey/use-deck-journey.ts`
  - **Cut** deals `CutSuggestion.severity === 'mandatory'`: rule problems plus severe misfits (play-rate score under `app_config.corpus.severeSynergyScore`). The list view pre-marks them and lets the player cut any card. **Replace** deals the `suggested` ones, each with a replacement, through `SwipeRater`
  - **Add** fills `openSlots`: room below 100 cards, not the number of cuts. Accepting a card asks `recs.add` again against the deck as it stands; passing only moves on, until every card on hand has been passed. Every add request sends the round's passed cards as `excludeCardIds` (contract v17). Entering Add with no open slots asks for nothing
  - Every rec call uses `workingDeck(state)`, so nothing is re-parsed until Review commits: Save and Re-analyze write `decklistFor(...)` into the box and analyze it (`useDeckTool.commitText`); Start over goes back to `originText`. Save and Re-analyze wait while `useDeckTool.stale`, so a round can't overwrite unanalyzed edits
  - **Rounds are keyed by `useDeckTool.round`**, bumped by every `submit()` and by Clear, never by analysis-object identity. A deck lookup that finishes mid-round re-reads the same deck (`refreshRecommendations`) and keeps the player's choices
  - **Settings changes reach the journey through `onContextChange`** (bracket, collection mode, a late collection, a finished lookup): `journey.reload(ctx)` asks again for the list on screen; the Replace sitting is keyed by `replace.version`, so replacements fetched under old settings are dropped. The tool itself only loads cuts
  - **Phases remember their lists.** The Add and Swap lists are kept with the key of the deck they were made for (`deckKey`): Add's is `workingDeck`, Swap's is `deckBeforeSwaps` (the deck without its swaps, so picking swaps never invalidates the list). Going back and returning to a phase shows the same list unless that deck changed; a settings change (`reload`) clears every key. A recomputed Swap list puts swapped cards it no longer names first, so every swap stays on the block. The replacements fetched for its cards live with the list (`replace.candidates`, passed to `SwipeRater cache`), so a sitting reopened over the same list fetches nothing it already has
  - **The stepper:** earlier steps always open; the next step does what the current step's Next does (Cut's applies its undecided cuts); a step further on opens only when the round has reached it (`JourneyState.reached`) and the Swap list still matches the deck as the current step would leave it (`stepper.canOpen`). A bracket check waiting in Cut keeps forward steps shut
  - **Replace deals by position**, so nothing is removed from a sitting's list while it runs. Decided cards (swapped out, kept with `keepInReplace`, or taken out of the deck) are stepped over as their turn comes (`skipTarget`), so a sitting reopened after leaving the phase resumes at the first open card; cards this round added are left out when targets load; candidates leave out every card swapped in or out this round and the replacements passed on for that card (`declinedSwaps`)
  - **A picked swap is a button**: tapping it in the Swaps list (or a swapped card in the list view) takes the swap back and reopens the sitting on that card (`SwipeRater startAt`), with the replacement picked before dealt first (`preferred`)
  - **`apply` builds on the latest round** (`latest.current`), not the render's: one handler can apply twice (the sitting's last swap, then on to Review), and the second must not undo the first
  - **A swap only counts while its card is in the deck**: the reducer drops swaps whose target is gone after any change. `removeFromDeck` / `withoutCards` take a card out wherever it came from
  - **A bracket change past Cut checks the deck as it stands**: `bracketMustCuts` (`@mtg/core/journey`, tested) applies the new bracket's Game Changer rules (all of them when it allows none, otherwise the excess, least played first). With must-cuts, the round goes back to Cut with every choice kept (`BracketCheckPanel`); Next becomes **Cut & Continue** or **Revert** (the previous bracket back through `useDeckTool.restoreBracket`)
- **Accept-rate events (T065, `lib/rec-events.ts`):** the tool records each list it deals and what the player does with it, fire and forget (`recordRecEvent`, a failure never shows). The action writes with `SUPABASE_SECRET_KEY` (`record_rec_event` is service_role's), keyed to the account from the session's claims or the request's visitor key, never to anything the browser sends. Add: the list when it loads, in the order it is dealt (lands first when a cut left the deck short of them, then best score), then each card taken or passed on (`use-deck-journey.ts`). Cut: on leaving the Cut step, its recommended cuts once per cut list, each cut or kept. Swap: a card's replacements the first time a sitting deals them, then each swap or pass (`use-swipe-rater.ts`, deck mode only; the card rater has votes). Builds record nothing until build mode has a screen (T069)
- **Request flow:** `components/deck/use-deck-tool.ts`, event-handler driven, stale responses dropped by request counters
- **Remembered deck:** `lib/saved-deck.ts` keeps the last deck in localStorage for 30 days (text, bracket choice, import source, commander names, a deck name given before saving). The tool puts it back in the box on mount, **unanalyzed** (owner decision 2026-09-23: opening `/deck` never analyzes an old deck by itself), and asks "Continue with <deck>?" in a centred dialog (`ResumeDeckDialog`): Yes analyzes it, No clears it, dismissing leaves it in the box. Analyze replays its bracket choice while the text is untouched; Clear forgets it. Browser-only
- **Deck name:** the deck bar's title is the deck's name (the open deck's, one the player gave it, or `suggestedDeckName`, its commanders') and tapping it renames the deck (`useDeckTool.renameDeck`: `renameDeck` for an open account deck, otherwise kept with the remembered deck and offered by Save). The commander's art links to their commander page, when they have one
- **Commander deck lookups:** when an analyzed deck has one commander with confidence `none`, `use-commander-lookup.ts` checks `getCommanderCoverage` first. An active lookup is joined ("someone else is also looking"); a standing not-enough or failed result shows a notice; otherwise it prompts
- **Link import:** a lone URL in the decklist box goes to `importDeckFromUrlAction`
- `/deck` offers the collection-first way in: with no collection it links to `/collection/import`, whose summary links back

### Saved decks in the app

- **The deck tool's `SaveDeckButton` is the only way to create a deck**, because new decks are public and a throwaway paste must never become a public page on its own. It sits in the Deckbuilder toolbar, and Upgrade's Review step opens it there. The name is prefilled from the commander
- **Once saved, a deck is written back on every change without asking.** `/deck?deck=<code>` (`openSavedDeck`, contract v9, owner-only) reopens a deck as **decklist text**, since the box is what the player edits; a card the catalog has dropped is left out. From then on `useDeckTool` writes back on every `submit()` (edited decklist, journey result, deckbuilder edit) and on bracket changes; the opening read does not write (`persist: false`)
  - Auto-save sends **cards and bracket only**, so it can never republish a hidden deck. A stale write is dropped by a request counter. `OpenDeckBar` reports saved, saving or the reason it failed
  - The open deck is held in a **ref as well as state**: `submit()` reads it in the same handler that may have just set it
  - Reopening is deliberately not `loadDeckPage`: the editor is the owner's alone. Someone else's deck is reported missing, not refused
  - `DeckTool` sits inside `<Suspense>` because it reads that search param
- **Saving checks the deck against the collection** (`SaveDeckButton`, `collectionShortfall` in `@mtg/core/collection`): cards the deck uses more copies of than the player owns are listed ("7× Plains"), with **Add & Save** (tops the collection up: a browser collection in place, an account one as a merged import, `lib/deck-collection.ts`) or **Save without adding**. It asks even with no collection; Add & Save then starts one. A signed-out player is sent to sign in with the deck kept in localStorage (`lib/pending-save.ts`, 24 h), and `/deck?resume=save` saves it to the account and opens its editor. Copies they chose to add go into a browser collection first, which moves to the account at sign-in like any other. Auto-save never asks
- **A save can carry `original`** (`useDeckTool.original`, sent only when the deck differs). The deck page shows what changed since and lets the owner restore it, an ordinary save of the original's cards
- **`/decks/[commander]/[code]`** serves owner and stranger from one route through `loadDeckPage`. **Export** (`components/decks/deck-export.tsx`, route `.../export?format=txt|csv`) answers `private, no-store`; the CSV's set code and collector number come from the printing whose image the page shows (Scryfall image URLs end in `printings.id`), and its Board column re-imports the commander (`decklistFromFile`)
- The visibility control's wording is load-bearing: hiding a deck does not remove it from the aggregates, and only a complete deck counts at all (the corpus rule in `../../CLAUDE.md`); `/privacy` says the same

### Deckbuilder (contract v14, v18, v19)

- `components/deckbuilder/`: a search to add cards and the deck as a list, every card editable. From `lg` the two are halves that scroll apart inside the window (search left, deck right); on a phone they are the Deck / Add cards tabs. Edits are pure functions in `@mtg/core/journey` `builder.ts` (tested): only basic lands take more than one copy, and commanders stay in step in both places a DeckInput keeps them
- **Decklist rows** (`DeckRow`): each card is a strip, grouped by type (Commander first, with a crown) and sorted by mana value, then name. The name and its cost symbols (`ManaCost`, from `CardSummary.manaCost`) sit over the art crop, which fades in from the right; Replace (blue on hover), Remove (red on hover) and a basic land's − n + sit at the end, dimmed until the row is pointed at. Pointing at a row (or focusing it from the keyboard) floats the whole card beside it (`previewPosition`: left of the row, else right, clamped to the window; a scroll closes it); pressing the row enlarges the card
- **In Deckbuilder mode the deck bar changes** (`DeckBar saveSlot`): the colours follow the name, the card count goes (the stats line has it), and Save deck (blue) takes the collection select's place. The collection moves into the search panel as Show: All cards / Owned only, which is the tool's collection setting (Owned only is `only`, All cards is `first`), so it limits replacements as well as search. Upgrade mode keeps the bar as it was. The active option of the Upgrade / Deckbuilder toggle (and the phone Deck / Add cards tabs) is filled blue with dark text
- **A saved deck is edited at `/decks/[commander]/[code]/edit`** (`SavedDeckEditor`, `loadDeckForEdit`, owner-only): edits auto-save 800 ms after the last one (cards only), and a pending one is written if the player leaves. Saving from the tool, and the Deckbuilder mode on an open deck, go there
- **Build a deck** (`/decks`) links to `/deck?start=build` (`BUILD_DECK_HREF`): a commander picker (the rater's `CommanderPicker`) takes the decklist box's place until there is a deck, and the picked commander opens as a one-card deck in Deckbuilder mode, cuts left for Upgrade
- **An unsaved deck is edited inline** in `/deck`'s Deckbuilder mode (`ToolDeckEditor`): edits go back into the decklist box through `commitText` 1.5 s after the last one, with `recs: false`; going back to Upgrade flushes a waiting edit or loads the waiting cuts (`ensureCuts`). The editor exposes `{ flush, discard, hasPending }` (`EditorHandle`): Save and the Edit decklist pencil flush first, Analyze and Clear discard, so an edit to the old deck never lands on a new one. It reaches the tool through a ref to the latest render
- **Search** (`CardSearchPanel`, contracts v18 and v19): top to bottom, type pips (All, Legendary, Creatures … Battles), cost pips (All, 0–7+), the name box with the A–Z / Z–A button and Clear, then Show (collection). Types narrow (every type picked must be on the card's front face, so Legendary + Creatures is legendary creatures and Artifacts alone includes artifact creatures), costs widen (any picked); none picked is All. Results are always alphabetical, the button flips the direction. A deck with no commander searches commanders only (`commanderEligible`). Results enlarge on click or tap only (`ZoomableCard hover={false}`): a hover-opened card in the scrolling panel got stuck open. A result already in the deck reads In deck and turns into Remove on hover or focus (Remove outright on touch)
  - **Typing a list in**: Add (or Enter, when the search found exactly one card) puts the card in and empties the name box, keeping its focus and the pills; Enter with several results does nothing, and Enter during the typing pause runs the search at once. Clear also hands the box focus back. Beside Show, one button per colour of the commander's identity (Wastes for colourless) adds a copy of that basic land (`BasicLandButtons`, each basic looked up once per page)
  - **Names match without their punctuation**: "garruk veiled" finds Garruk, Veiled Butcher and "high society" High-Society Hunter. Postgres also matches `card_names.name_loose` from three characters (trigram index `card_names_loose_trgm`), in `search_cards` and `search_cards_filtered`; the index splits words on `-` and `/` (`CARD_SCHEMA.token_separators`)
  - It runs on the search index (`card_types` with legendary, `colors`, `mana_value`; `type` and `mv` travel comma-separated, `sort` as `name_asc` / `name_desc`), with `search_cards_filtered` in Postgres (`public.card_types`, covering index `cards_deckbuilder_browse`) as the fallback, answering identically. New index fields need `sync:typesense --rebuild`; until an index has them, the index read fails and Postgres answers
  - **Owned only goes to Postgres alone**: `ownedOnly` makes the search a POST (a browser collection travels in the body; an account one is read on the server), answered `private, no-store` with `x-search-source: postgres-owned`. A collection can be tens of thousands of ids, which Postgres matches as a hashed set (`p_owned_ids`) and no index filter should carry

### Collections

- **`/collection`** (contract v10): browse what you own, filtered by name or tag, colour identity and set, grouped by card type (legendary creatures apart). Entries come from the browser (rows folded per card) or the account (`my_collection_entries()`); cards, tag labels and set names come from `POST /api/cards/collection` (`loadCollectionCards`) in chunks of `MAX_COLLECTION_CARD_IDS`. Filter rules are `@mtg/core/collection` (tested). Images are the card's representative printing: `printings` stores no images
- **Editing by hand** (contract v15): Edit collection mode puts +, − and remove on every card and a name search to add more (`use-collection-editor.ts`, `collection-edit.tsx`). The page changes at once; each card's latest count is written 500 ms after its last click, a failed write puts it back, and leaving the page writes what was waiting. A collection is still started by importing one (T038)
- **`/collection/import`** (`components/collection/collection-tool.tsx`): parses pasted text or a file in the browser and matches it 2,000 rows per call (`resolveCollectionRowsAction`). Signed out, the result stays in IndexedDB for 7 days (`lib/collection-store.ts`; localStorage can't hold large collections). Signed in, it replaces the account's collection through `saveCollectionBatchAction`
  - Files are read by `components/collection/file-drop.tsx`. A collection is parsed in a Web Worker (`use-collection-parser.ts`) with a main-thread fallback, because a strict CSP can refuse the worker's module script
  - A lone Archidekt collection link (`archidekt.com/collection/v2/<id>`) goes to `importCollectionFromLinkAction`: up to `ARCHIDEKT_PAGES_PER_CALL` (4) export pages a second apart per call, and the browser calls again until `nextPage` is null. A collection over `COLLECTION_MAX_IMPORT_ROWS` is refused as soon as the first page gives the total, never truncated
- **Where the collection is:** `useCollectionSource` (`components/collection/use-collection-source.ts`) tells the deck tool and the collection page (none, browser, account). Right after sign-in, `AccountCollectionSync` (rendered by the header's `AccountLink`) merges a browser collection into the account, clears the browser copy and calls `notifyCollectionChanged()`; a Web Lock stops two tabs moving it twice, and a failed move keeps both copies and retries on the next page load
- **The deck bar's My collection select** (Owned first, Owned only, Ignore it; remembered in localStorage under the old `owned-only` key, where "1" reads as owned only and no choice means owned first) sends `ownership: { kind: "session", ownedCardIds }` for a browser collection or `{ kind: "account", deckId }` (the open saved deck, if any; read server-side through `my_card_availability`, UNAUTHENTICATED when signed out), plus `ownershipMode`. The buy list, conflicts and the built-deck control have no UI yet (T069)

### Accounts

- `/sign-in` sends a 6-digit code and a link (`sendSignInEmailAction`); the code is checked by `verifySignInCodeAction`; the link goes to `/auth/confirm`, which verifies a token hash, so it works on any device. Google goes through `startGoogleSignInAction` → `/auth/callback`
- `lib/server/auth.ts`: `createAuthClient()` (`@supabase/ssr`, cookies) and `getCurrentUser()` (uncached, behind `<Suspense>`)
- `/account` holds account deletion (`deleteAccountAction`, typed confirmation) and, for admins only, the one link to `/admin`
- Locally, sign-in emails land in Mailpit (http://127.0.0.1:56324); `E2E_MAILPIT_URL=http://127.0.0.1:56324` enables `e2e/sign-in.spec.ts`, `e2e/account-collection.spec.ts` and `e2e/admin.spec.ts`. `signIn` clears that address's inbox first, because a fixed account's inbox holds every earlier run's codes. Repeated full runs inside an hour exhaust the local email budget; the tests pass in isolation, and CI skips them

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

## UI

- **Design direction "Kitchen Table"** (2026-09-29, replacing "Table at night"): a friend's kitchen table on game night meets a well-thumbed trade binder. The app should feel like an experienced friend sifting your cards with you, not a statistics engine. Mobile-first is the top priority, and every card shown must show its image. Dark only (a light theme is shelved)
  - Tokens live in `src/app/globals.css`: walnut `--background`, oak `--sleeve` for panels, warm-paper `--foreground`, and `--primary` (sleeve blue) as the one accent, on actions, links, focus and the selected state only. `--cut`, `--add` and `--replace` name the three jobs and always come with an icon and a label. The previous palettes are kept as `--*v3`, `--*v2` and `--*v1`
  - Fonts: Bricolage Grotesque for headings and UI (only 400 and 600 are loaded, so `font-normal` and `font-semibold` are the only weights), Newsreader Italic (`font-drama`) for the buddy's voice and quoted speech only (the headline phrase, asides, the "Sound familiar?" cards), never for UI labels, and DM Mono (`font-mono`) for standalone numbers (counts, prices, play rates, stat tiles) and eyebrows. A sentence that contains numbers stays in the body font with `tabular-nums`. DM Mono loads 400 only, so never pair it with `font-semibold`
  - The type scale is `text-xs` to `text-4xl` = 12 / 14 / 16 / 18 / 24 / 32 / 44 / 60 px, redefined in `@theme`; no arbitrary `text-[…]` sizes. Radius: `rounded-lg` (8 px) for controls, `rounded-panel` (14 px) for panels. Only cards being handled cast a shadow (`shadow-lift`); the grain is a body background, so it never covers panels or card art. Touch targets are at least 44 px on phones: `Button` draws an invisible 44 px `::after` below `sm` (`PHONE_HIT_AREA`), `lg` buttons are 44 px tall there, and compact custom controls use the same `::after` trick rather than growing
  - **Blue means you can press it, and everything you can press shows blue.** One treatment per kind of control: the primary action is a blue fill, a secondary action a hairline outline, every text link `TEXT_LINK` (`lib/constants.ts`: blue, underlined; footer and credits included), nav items muted with a blue underline for the current page, pressable surfaces (the "Sound familiar?" cells, commander tiles) turn over to or edge in blue on hover and focus, icon-only buttons (and ghost buttons) grey at rest and blue on hover and focus (delete turns red instead), and pressable card images a blue focus ring and a slight lift on hover, never blue on the card itself. Static panels carry no blue
  - The signature is "the pass": a card slid onto the hand (the hero fan's passed card, `.pass-card` in `globals.css`). A one-line aside in `font-drama` may go with it where the page is about that card; the hero has none
- **Page width:** every page, header and footer sits in `page-column` (`globals.css`): the margins beside it are half what a fixed 72rem column would leave. Anything that must reach from the column to the window edge reads `--page-column`
- **Shared surfaces:** `Band` (`components/ui/band.tsx`, a full-width stripe closed by a window-wide rule, content in the site column), `Panel` (`components/ui/panel.tsx`, `rounded-panel`, surface `sleeve` or `table` for page-coloured cards), `SectionHeading` (small ruled mono eyebrow over an `h2`) and `ArtBackdrop` (land art behind a section, washed toward where the copy sits). Landing-page art and its credits live in `lib/landing-art.ts`; swapping a vista is one entry there. `DeckOverview` takes `compact` (ring and mana symbols, no title or legend; from `md` the ring fills its parent's height) and `deckKey` (a change empties the ring, then refills it with the new deck); pointing at a slice dims the rest and names it in the centre. How it works shows each step as its recording with a one-line caption at its foot (the "Sound familiar?" heading size where the card has room, stepping down the scale by container width so it never wraps or truncates), no numbers or descriptions. The recordings are in `public/` (`add.png`, `cut_gif*.gif`, `swipe_gif*.gif`; `_hi` from 1024 px up). Home illustrations use fixture cards (`lib/sample-cards.ts`), so the page renders without the database. "Sound familiar?" (`components/home/situations.tsx`) is a thin full-width ribbon: the prompt, then four quotes divided by single rules, each a link that turns over on hover (after 150 ms) or keyboard focus to "+ Decklist", "+ Commander" or "+ Collection", the whole cell filled blue with dark text like the primary button, with the deck tool's Add symbol. Touch has no hover, so the first tap turns a cell and the second follows it
- **shadcn/ui** (`radix-nova` style, Radix primitives); `cn` from the `cn` package (pinned exact version)
- **PocketGrid** uses `@container` (`@md:`/`@xl:`/`@3xl:`), not viewport breakpoints: columns answer to the container
- Card images: `unoptimized`, hotlinked from Scryfall via `components/cards/card-image.tsx`. Never overlay badges or UI on the lower part: Scryfall requires the artist/copyright line visible
- **Pick the image `variant` from the size it renders at.** `unoptimized` means no srcset, so the browser fetches whatever `variant` names, whole: `small` 146×204 (~13 KB), `normal` 488×680 (~93 KB), `large` 672×936. **Every grid of cards is `small`**, up to `PocketGrid`'s 160 px pockets; `normal` is for a card shown alone at a few hundred pixels; `large` for one deliberately enlarged
- **A search-as-you-type field keeps its results on screen while the next search runs** (dimmed, `aria-busy`) and aborts the call it superseded (`CallOptions.signal`, contract v16). Replacing results with a loading state unmounts every image; leaving stale requests live starves the one that matters
- **`/deck` on a phone is budgeted for the swipe view.** `DeckBar` is two lines (deck name, colours, card count and an Edit decklist pencil; bracket and collection selects on the right). Deck issues are a warning chip beside the name that opens a bottom sheet (`DeckIssuesChip`), on every screen width; the collapsed issue list (`ResolutionIssues`) is only for pages without the bar. Swipe or list is one icon beside the steps (`ViewToggle`); the labelled control is for wider screens. Game Changers follow the bracket (`defaultIncludeGameChangers`) with no control of their own. In Swipe view each phase's heading and its one-line hint (`PhaseIntro` `brief`) are screen-reader only: ✓ and ✕ say what the gestures do. The swipe cards size themselves from `100lvh` (not `dvh`, which grows as the address bar hides on scroll and made the cards grow) minus what surrounds them (`--swipe-chrome`), so re-measure at 390×844 after adding anything above them: ✓ and ✕ must stay on screen without scrolling
- `DeckBar` publishes its own height to `--deck-bar-height` (`DECK_BAR_HEIGHT_VAR`, `lib/constants.ts`); sticky surfaces below it offset by `var(--deck-bar-height,0px)`
- A file read into the deck or collection form replaces the drop zone and the text box with `LoadedFile` (name, line count, Show text), so the submit button stays under it; a pasted list gets `IMPORT_TEXT_BOX`, capped and scrolling inside
- `components/layout/ad-slot.tsx` marks future ad positions and renders nothing until a slot is enabled

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

## Check scripts

Run with `yarn workspace @mtg/web tsx [--env-file=.env.local] scripts/<name>.ts`.

| Script | Checks | Needs |
|---|---|---|
| `retry-timeout-check.ts` | Statement-timeout retry | nothing (faked) |
| `search-index-check.ts` | The app survives a missing, slow or broken index | nothing (faked) |
| `archidekt-cron-check.ts`, `moxfield-cron-check.ts` | Cron route: `CRON_SECRET` gate, spoofed headers refused, forwarded POST | nothing (faked) |
| `share-kill-switch-check.ts` | A challenge switches the source off with an audit row | local database |
| `collection-resolve-check.ts` | Collection matching, including a batch past the row cap | local database |
| `search-parity-check.ts` | The index agrees with Postgres | local database and index |
| `rec-regress.ts` (`yarn workspace @mtg/web regress [dir]`) | Recommendation fixtures | local database; fixture files in `[dir]` or `$MTG_DATA_DIR/regression`, never in the repo |
| `dev-sign-in.ts` | Prints a sign-in link for a local account | local database |
| `build-featured-decks.ts` | Regenerates the featured-decks fixture | local catalog and corpus |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
