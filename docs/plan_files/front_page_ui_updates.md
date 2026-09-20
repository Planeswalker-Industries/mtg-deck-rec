# Homepage redesign: Popular Commanders, Deck Overview, three steps

## Context

The landing page today is two sections: the full-bleed hero (art, card fan, headline, two CTAs, the CUT/ADD/REPLACE row) and one prose box, "Ranked from decks people actually built." It tells a visitor what the tool claims to do and never shows it doing it. Nothing on the page is a real deck, a real commander, or a real number.

The mock replaces the prose box with proof: three popular commanders from our own corpus, each with its art, colors, a plain-language summary and a full card-type breakdown of a real 100-card list, plus a one-click way to open that list in the deck tool. Below it, the three steps a new visitor actually takes, and a closing CTA.

Hero and navbar are untouched. This is everything below the hero.

### Decisions already made (do not re-litigate)

| Question | Answer |
|---|---|
| Popularity source | Our own Archidekt corpus (`commander_stats.deck_count`). Not EDHREC — no automated fetch anywhere. |
| Featured decklists | **POC: three decklists from our corpus, generated offline and checked in as fixtures.** The corpus JSONL lives on `X:` and never reaches Postgres or Vercel, so a runtime read is impossible; a fixture is the only shape that works. |
| "Build this Deck" | Opens `/deck?commander=<slug>` with the list loaded and analyzed. |
| Cycling | Motion carousel: auto-advances on a timer **and** takes manual input. |

### One flag, carried forward

`CLAUDE.md` says third-party decklists are "used for aggregates only and never exposed". Publishing a corpus deck verbatim is exposure. The generator below therefore builds each list **from play rates** — the top cards per category for that commander, plus basics — exactly as `apps/web/src/lib/sample-deck.ts` already does for Liesa ("built from aggregate play rates rather than any one player's deck"). Same result on screen, no individual deck republished, no re-crawl. If you want a verbatim deck instead, say so and I'll swap the generator's source; everything downstream is unchanged.

---

## Design

The site's direction is fixed — "table at night", one warm lamp, gold marks the one action that matters. This work extends it rather than inventing anything, with one genuinely new decision.

**The new decision: card-type colors for the ring.** Two palettes in `globals.css` are already spoken for and must not be borrowed — `--color-mana-*` means color identity, `--cut`/`--add`/`--replace` mean the three jobs. A ring painted in either would say something false. Add seven `--cat-*` tokens: mid-chroma, near-equal lightness (oklch L≈0.70), deliberately duller than the job colors, so seven slices separate without any of them competing with the gold. Colour is never the only channel — the legend carries name and count in words, following the admin area's status-pill precedent.

**Restraint.** The ring is the one loud thing on the page. Everything around it — the aside, the steps, the closing CTA — stays quiet: `border-seam`, `bg-sleeve`, muted text, `lit` only on the raised panel and the one gold button.

**The steps are genuinely a sequence**, so numbering them is information, not decoration. That is the only place on the page numbered markers appear.

---

## Layout

```
┌─ hero (UNCHANGED) ────────────────────────────────────┐
└───────────────────────────────────────────────────────┘
  art credit (unchanged)

  POPULAR COMMANDERS
┌──────────┬────────────────────────────────────────────┐
│  aside   │  ┌─ art ─┬─ name / colors / summary ─┐     │
│ (art,    │  │       │  Build this Deck  →       │     │
│ <details>│  ├───────┴───────────────────────────┤     │
│  open,   │  │        DECK OVERVIEW              │     │
│  lg+     │  │   ◍ ring      legend 7 rows       │     │
│  only)   │  └───────────────────────────────────┘     │
│          │         ● ○ ○   ← carousel dots            │
└──────────┴────────────────────────────────────────────┘

  ① Add your decklist  → ② Import your collection → ③ Find the perfect swaps

┌─ Your collection. Your deck. Optimized.  [Get started] ┐
└───────────────────────────────────────────────────────┘
```

Phone: aside gone entirely, the panel is a single stack (art, then name/colors/summary, then button, then ring above legend), steps stack vertically with the arrows dropped.

Grid is `lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]` on the section — one grid, not nested columns, matching the deck workspace's approach (`deck-tool.tsx:299`).

---

## Files

### New

| Path | What |
|---|---|
| `apps/web/src/lib/featured-decks.ts` | The three fixtures. Per entry: `slug`, `commanderName`, `summary`, `decklist` (text), `composition` (`Record<CardCategory, number>`), `cardCount`. Precomputed counts mean the ring needs **zero** database reads. Sits beside `sample-deck.ts` and follows its doc-comment convention. |
| `apps/web/scripts/build-featured-decks.ts` | Local-only generator (`tsx`, needs the synced catalog + corpus). Reads the top commanders by `commander_stats.deck_count`, builds each list from `commander_card_stats` play rates per `cardCategory` + basics to 100, counts categories with `cardCategory` from `@mtg/core/scoring`, drafts the summary from the commander's `card_functional_tags`, and prints the fixture file. Run by hand; output is reviewed and committed. Never runs in CI or at build time. |
| `apps/web/src/lib/server/featured.ts` | `loadFeaturedCommanders(db)` — one indexed read of `cards` by the three slugs for `name, slug, images, artist, color_identity`, plus `commander_keys`/`commander_stats` for `deckCount`. Returns `null` on any error, like `getHeroArt` does. |
| `apps/web/src/components/home/featured-commanders.tsx` | `"use client"`. The carousel. Takes all three (server-rendered data) as props. |
| `apps/web/src/components/home/deck-overview.tsx` | The ring. Pure presentational, no client JS — an inline SVG donut plus legend. Takes `composition` and `cardCount`. |
| `apps/web/src/components/home/art-aside.tsx` | The collapsible left aside. |
| `apps/web/e2e/home.spec.ts` | See Verification. |

### Changed

| Path | Change |
|---|---|
| `apps/web/src/app/page.tsx` | Keep lines 1–182 (hero, fan, `HeroArtLayer`, `HeroCredit`) **exactly as they are**. Replace the prose `<section>` at 184–196 with: the Popular Commanders grid, the three steps, the closing CTA. Add one `<Suspense fallback={null}>` around the featured-commander data, same as the hero's — the landing page must still render with the database down (`CLAUDE.md`, and it is checked). |
| `apps/web/src/lib/server/recs-cache.ts` | Add `getFeaturedCommanders()` next to `getHeroArt` (`:23`): `"use cache"`, `cacheLife("days")`, `cacheTag("catalog", "corpus")`. |
| `apps/web/src/app/globals.css` | Seven `--cat-*` tokens in `:root` and their `--color-cat-*` mappings in `@theme inline` (beside the mana block at `:42`), with a comment saying why they are not the mana or job colors. |
| `apps/web/src/components/deck/deck-tool.tsx` | Beside `?deck=` at `:44`, read `?commander=`. When present and it names a fixture, call `tool.submit({ text: fixture.decklist, bracketOverride: null, gameChangerOverride: null, importedFrom: null })` instead of `restoreLastDeck()`. An unknown slug falls through to the remembered deck, like a failed `openSavedDeck` already does (`:68-73`). |

**No contract change and no version bump.** The fixture is a client-side constant, so `submit()` takes it through the existing `parseDeck` path. No new server action, no migration, no worker change.

---

## Implementation notes

### Featured commanders carousel (Motion)

Motion is already a pinned dependency (`motion/react`, used by `swipe-rater.tsx`). From the docs read for this plan:

- `<AnimatePresence mode="wait" custom={direction} initial={false}>` wrapping a single `<motion.article key={slug}>`. Changing the key is the documented slideshow pattern; `initial={false}` stops it animating on first paint, which matters because this is above the fold.
- `custom={direction}` + dynamic variants so a slide leaves the way the visitor pushed it.
- `useReducedMotion()` → **no auto-advance and a cross-fade instead of an x-slide.** Motion's hook re-renders on change, so this is live, not load-time.
- Timer: ~7s, cleared and restarted on any manual change, **paused on hover and on focus-within**. A carousel that moves while someone is reading it is a bug.
- Manual control is three dots with real `aria-label`s (`"Show Liesa, Forgotten Archangel"`), `aria-current` on the active one, and left/right arrow keys when the group has focus. The panel gets `aria-live="polite"` so the change is announced.
- All three panels' data is server-rendered and passed as props; only the visible one is in the DOM. Card images for the two inactive commanders use `eager={false}`.

### Deck Overview ring

**Load the `dataviz` skill before writing this component** — it is a chart, and the repo has no chart code at all today (searched: no SVG chart, no chart library).

- Inline SVG donut, `stroke-dasharray` on seven `<circle>`s, no library, no client JS. Server-rendered inside the client carousel as a prop-driven child.
- Centre holds `93 / 100 cards`; the ring is the shape and the legend is the data. `role="img"` with an `aria-label` naming every category and count, because a donut is unreadable to a screen reader.
- Legend rows: swatch, name, count. Order is `CATEGORY_ORDER` from `commander-page.ts:12`, so it matches the commander page. Labels come from `cardCategoryLabel` in `lib/labels.ts` — do not write new ones.
- Colors row beside the name uses the existing `ColorIdentity` component (`components/deck/color-identity.tsx`), not new pips.

### Collapsible aside

No shadcn `collapsible.tsx` or `sidebar.tsx` exists, and the repo's idiom is native `<details>/<summary>` — see `score-explainer.tsx:66`, `resolution-issues.tsx:29`, `collection-tool.tsx:312`. Use that.

`<aside className="hidden lg:block">` with `<details open>` inside: hidden on mobile by CSS, open by default on desktop, collapsible by click, and **identical markup on server and client** — the same reason the deck workspace's two selector states are CSS rather than a media query (`CLAUDE.md`, and it is what keeps Playwright strict mode usable).

Content is the active commander's art crop with the tagline. Per `art-backdrop.tsx`'s rule: **no `artist` means no art shown** — uncredited art is worse than none — and the credit links to `/card/<slug>`.

### Three steps

Replaces the mock's CUT/ADD/REPLACE cards, which would only repeat the row already in the hero.

1. **Add your decklist** — paste, or import from Archidekt, ManaBox, Moxfield or TCGplayer.
2. **Import your collection** — a CSV or text export from the same apps. Optional, and the copy says so.
3. **Find the perfect swaps** — cuts, additions and substitutes, with the price difference before you commit.

Numbers are rendered as real content, not decoration; step 3's verb matches the tool's own words.

### Closing CTA

"Your collection. Your deck. Optimized." + one gold `Get started` → `/deck`. One button, `lit`, no secondary action — a second choice here would dilute the only one that matters.

---

## Verification

```bash
yarn typecheck && yarn lint && yarn test && yarn build
```

Then, against the local Supabase with the real catalog and corpus:

```bash
yarn workspace @mtg/web tsx --env-file=.env.local scripts/build-featured-decks.ts
```

Review its three lists by hand before committing the fixture — this is the one step no test can do for you.

```bash
yarn dev
```

Check by hand at 390px and at desktop:

- Hero and navbar are pixel-identical to `main`.
- Carousel advances on the timer, stops on hover and on focus, dots and arrow keys work, and the panel announces the change.
- With `prefers-reduced-motion` on (Chrome DevTools → Rendering): no auto-advance, cross-fade only.
- The aside is absent at 390px and open at `lg`, and collapsing it does not reflow the panel.
- Ring counts sum to the fixture's `cardCount`; the legend reads correctly with colour ignored.
- "Build this Deck" lands on `/deck?commander=<slug>` with that list parsed and cuts/adds loading.

**Database-down check** (`CLAUDE.md` requires the landing page survive this): point the fixture slugs at a card that does not exist, or stop Supabase, and confirm the page still returns 200 with the headline intact — art and commander data absent, no server error.

```bash
yarn workspace @mtg/web e2e
```

New `e2e/home.spec.ts`: the three step headings are present; the aside is hidden at 390px; the ring's `aria-label` names all seven categories; clicking a dot swaps the commander name; "Build this Deck" navigates to `/deck?commander=`. No `E2E_LOCAL_DATA` gate — the fixtures are checked in, so this runs in CI.

Screenshots last:

```bash
node X:\mtg_proj\tools\shoot.mjs
```
