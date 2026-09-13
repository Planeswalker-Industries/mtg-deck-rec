# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

mtg-deck-rec: public Commander-only web app. Paste or import a decklist → cards to add, cards to cut, and functional substitutes (click a card) with an estimated cost delta. Two modes share one pipeline: **collection-less** (anonymous; ranked by corpus play rate + Scryfall Tagger tags) and **collection-aware** (candidate pool restricted to owned cards).

Status: Phase 0 (spike). Only `packages/core` exists so far; `apps/web` (Next.js 16) and `apps/worker` (ingestion) are planned.

## Commands

Yarn 4 workspaces (`nodeLinker: node-modules`), Node ≥ 24.

```sh
yarn install
yarn typecheck                                   # all workspaces
yarn test                                        # all workspaces
yarn workspace @mtg/core typecheck
yarn workspace @mtg/core vitest run src/contract/mocks/mocks.test.ts   # single test file
yarn workspace @mtg/core vitest run -t "swap"                          # tests matching a name
```

TypeScript is pinned to 6.0.x on purpose: TS 7 (native) lacks the JS API that Next's type checking relies on.

## Architecture

- `packages/core/src/contract/` is the **frontend/backend contract** and the source of truth for API shapes. Frontend builds against `createMockApis()` (`@mtg/core/mocks`); backend implements the same `RecsApi` / `ActionsApi` / `DataApi` interfaces. Change the contract via PR only.
- Transport split (planned in `apps/web`): public reads are Server Components with `use cache` (pages must SSR and stay indexable); recommendations are Route Handlers `POST /api/recs/{swap,add,cut}` because Server Actions are dispatched serially; Server Actions are for mutations only.
- Planned later in core: `formats/commander/` (the one format implementation behind a thin `FormatRules`/`GateParams` seam), `parse/` (decklist + collection parsers), `scoring/` (normalize + weighted-sum blend, shared with the recommendation regression harness).

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
