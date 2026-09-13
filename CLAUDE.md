# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

mtg-deck-rec: public Commander-only web app. Paste or import a decklist → cards to add, cards to cut, and functional substitutes (click a card) with an estimated cost delta. Two modes share one pipeline: **collection-less** (anonymous; ranked by corpus play rate + Scryfall Tagger tags) and **collection-aware** (candidate pool restricted to owned cards).

Status: Phase 0 (spike). `packages/core` (contract + mocks) and `apps/web` (deck tool running on mocks) exist; `apps/worker` (ingestion) and Supabase are planned.

## Commands

Yarn 4 workspaces (`nodeLinker: node-modules`), Node ≥ 24.

```sh
yarn install
yarn dev                                         # apps/web on http://localhost:3000 (mock data)
yarn typecheck | yarn lint | yarn test | yarn build   # all workspaces
yarn workspace @mtg/web typecheck                # next typegen + tsc (typegen creates LayoutProps/PageProps globals)
yarn workspace @mtg/core vitest run src/contract/mocks/mocks.test.ts   # single test file
yarn workspace @mtg/core vitest run -t "swap"                          # tests matching a name
```

TypeScript is pinned to 6.0.x on purpose: TS 7 (native) doesn't ship the JS compiler API, which typescript-eslint (via eslint-config-next) needs. Next 16.3 itself type-checks through the `tsc` CLI and would accept TS 7.

`apps/web` targets Next.js 16.3 — APIs differ from older versions. Read the bundled docs in `node_modules/next/dist/docs/` before writing Next code (see `apps/web/AGENTS.md`).

## Architecture

- `packages/core/src/contract/` is the **frontend/backend contract** and the source of truth for API shapes. Frontend builds against `createMockApis()` (`@mtg/core/mocks`); backend implements the same `RecsApi` / `ActionsApi` / `DataApi` interfaces. Change the contract via PR only.
- Transport split (planned in `apps/web`): public reads are Server Components with `use cache` (pages must SSR and stay indexable); recommendations are Route Handlers `POST /api/recs/{swap,add,cut}` because Server Actions are dispatched serially; Server Actions are for mutations only.
- Planned later in core: `formats/commander/` (the one format implementation behind a thin `FormatRules`/`GateParams` seam), `parse/` (decklist + collection parsers), `scoring/` (normalize + weighted-sum blend, shared with the recommendation regression harness).
- `apps/web` runs with `cacheComponents: true`: uncached or request-time reads must sit inside `<Suspense>`; pair every `use cache` with `cacheLife`; `revalidateTag` takes a second (profile) argument. `proxy.ts` replaces `middleware.ts`.
- Client code reaches the contract only through `apps/web/src/lib/api/client.ts` (`getApis()`), currently backed by the mocks. The deck tool's request flow lives in `components/deck/use-deck-tool.ts` (event-handler driven, stale responses dropped by request counters).
- UI is shadcn/ui (`radix-nova` style, Radix primitives). Generated components import `cn` from the `cn` package (shadcn's clsx + tailwind-merge replacement), pinned to an exact version.
- `components/layout/ad-slot.tsx` marks future ad positions; it renders nothing until a slot is enabled. `/deck` is `noindex` — indexable content belongs on card/commander pages.

## Domain conventions

- `CardId` is an int surrogate 1:1 with Scryfall `oracle_id`. Decks and recommendations are oracle-level; collections are printing-level (`PrintingId` = Scryfall card id).
- Tagger tags are keyed by their **UUID**, never slug/label. Bulk data holds only direct taggings; parent tags are reached through the hierarchy.
- Prices are estimates and must always render with their as-of timestamp.
- Scryfall `edhrec_rank` is not used anywhere.

## Hard constraints

- No bot-detection circumvention anywhere: no cloudscraper-class libraries, fingerprint spoofing, UA rotation, or proxies. Every outbound request sends an accurate descriptive `User-Agent` (and `Accept` for Scryfall).
- Data sources qualify only by documented API, published terms, or direct operator permission. Do not add Deckstats, Aetherhub, MTGGoldfish, TappedOut, or EDHREC `json.edhrec.com`. Moxfield only if authorization is granted.
- Third-party decklists are used for aggregates only and never exposed.
- The repo is public: anti-abuse thresholds and scoring weights belong in database config, not code.
