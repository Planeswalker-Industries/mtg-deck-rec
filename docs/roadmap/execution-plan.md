# MTG Collection-Aware Deck Optimizer — Execution Plan

## Context
Greenfield repo (`wuddat/mtg-deck-rec` at the time, now `Planeswalker-Industries/mtg-deck-rec`, **public**; README + CLAUDE.md only). Goal: public Commander web app. Paste/import a decklist and get (a) **cards to add** (EDHREC-style), (b) **cards to cut**, (c) **top-N functional substitutes** when a card is clicked, each with an estimated cost delta. Two modes share one pipeline: **collection-less** (anonymous, ranked by corpus play rate + Tagger tags) and **collection-aware** (candidate pool restricted to owned cards). Team: 1 FE + 1 BE, so a typed contract is frozen early and FE builds against mocks.

### Step 0 outcomes (locked)
| # | Decision |
|---|---|
| Anon collection | **IndexedDB client-side**, 7-day TTL. Uploaded once after signup. Nothing stored on the server. |
| Rec surfaces | **Add list** (by category) + **Cut list** (in-deck) + **Swap drawer** (click any card → top-N substitutes) |
| Indexable surface | SSR `/card/[slug]`, `/card/[slug]/alternatives`, `/commander/[slug]`. Paste tool is `noindex`. |
| Brackets | Bracket **inferred** from deck (user can override). **Game Changer badge** on every GC. **Include-GC toggle**: defaults off for brackets 1–2, on for 3–5. Bracket 3 warns past 3 GCs. |
| Sync gating | Gate on bulk-data `updated_at` + per-row content hash. **Manifest not used** (it tracks only additions and image updates). |
| Catalog source | **Oracle Cards** (card level) + **All Cards** (slim printings table). Art Tags skipped. |
| Price | `reference_price_usd` = cheapest non-foil paper USD → foil/etched → null. Always "est. as of". |
| Corpus | Production Archidekt crawler lands in **Phase 1**. Aggregates only; third-party decklists never exposed. |
| Hosting | Vercel **Pro** for the app. Scryfall/tag sync on **GH Actions** via the Supavisor session pooler (IPv4). Archidekt crawler on a small always-on container (Fly/Railway/Render). **Supabase Pro** from Phase 1. |
| Transport | RSC + `use cache` for reads. **Route Handlers** for recs (Server Actions are dispatched one at a time per client, and add+cut+swap must run in parallel). Server Actions for mutations. |
| Scale target | 10k DAU, 50 rps peak. Public pages CDN-cached; personalized recs uncached. |
| Votes | Global pair key; commander stored as context. Bayesian average, never Wilson LB. |

Outbound email in week 1 (BE): Moxfield (whitelisted UA), Archidekt (confirm commercial use of aggregates; archive forum permission post in `docs/permissions/`), Scryfall (public-deck programmatic access).

---

## 1. Database schema (Supabase migrations in `supabase/migrations/`)

Conventions: `cards.id` is an int surrogate, 1:1 with `oracle_id`, never reissued (compact arrays, IndexedDB payloads). Name normalization is done **once in TS** (`packages/core/parse/normalize.ts`: NFKD, strip diacritics, lowercase, `’`→`'`, collapse spaces, canonical ` // `) and stored, so no SQL `unaccent` is needed in indexes. Aggregate tables are rebuilt by building a `_new` table and renaming it in one transaction, so they carry no FKs.

### 1.1 Extensions, formats, catalog
```sql
create extension if not exists pg_trgm;

create table formats (                       -- one row: 'commander'. Seam for a 2nd format.
  code text primary key,
  name text not null,
  deck_size smallint not null,
  singleton boolean not null,
  uses_color_identity boolean not null,
  has_command_zone boolean not null,
  scryfall_legality_key text not null        -- key into cards.legalities
);

create table cards (
  id integer generated always as identity primary key,
  oracle_id uuid not null unique,
  name text not null,
  name_normalized text not null,
  slug text not null unique,
  layout text not null,
  mana_value real not null,
  type_line text not null,
  oracle_text text,
  card_faces jsonb,
  color_identity smallint not null check (color_identity between 0 and 31), -- W1 U2 B4 R8 G16
  is_basic_land boolean not null,
  can_be_commander boolean not null,
  partner_kind text,          -- partner|partner_with|partner_qualified|friends_forever|background|choose_background|doctor|doctors_companion
  partner_qualifier text,     -- "Partner with X" name or "Partner—<qualifier>"
  copy_limit smallint,        -- null = format default; 0 = unlimited; 7 Seven Dwarves; 9 Nazgûl
  legal_commander text not null check (legal_commander in ('legal','not_legal','banned','restricted')),
  legalities jsonb not null,
  game_changer boolean not null default false,
  is_digital_only boolean not null,
  released_at date,
  image_uri text,
  scryfall_uri text not null,
  reference_price_usd numeric(10,2),
  reference_price_finish text,
  prices_as_of timestamptz,
  content_hash bytea not null,   -- excludes prices
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index cards_name_trgm on cards using gin (name_normalized gin_trgm_ops);
create index cards_commander_pool on cards (color_identity) include (mana_value, game_changer)
  where legal_commander = 'legal' and not is_basic_land and deleted_at is null;

create table card_names (                    -- resolution aliases
  card_id integer not null references cards(id) on delete cascade,
  name_normalized text not null,
  kind text not null check (kind in ('full','face','flavor','printed','alchemy')),
  primary key (name_normalized, card_id, kind)
);
create index card_names_trgm on card_names using gin (name_normalized gin_trgm_ops);

create table printings (                     -- from All Cards, slim projection
  id uuid primary key,                       -- Scryfall card id
  card_id integer not null references cards(id),
  set_code text not null,
  collector_number text not null,
  lang text not null,
  finishes text[] not null,
  is_digital boolean not null,
  tcgplayer_id integer,
  tcgplayer_etched_id integer,
  usd numeric(10,2), usd_foil numeric(10,2), usd_etched numeric(10,2),
  prices_as_of timestamptz,
  released_at date,
  content_hash bytea not null,
  deleted_at timestamptz
);
create index printings_set_cn on printings (set_code, collector_number, lang);
create index printings_card on printings (card_id);
create index printings_tcg on printings (tcgplayer_id) where tcgplayer_id is not null;
create index printings_tcg_etched on printings (tcgplayer_etched_id) where tcgplayer_etched_id is not null;

create table slug_redirects (old_slug text primary key, kind text not null, target_id bigint not null);
```

### 1.2 Tags, hierarchy, kill switch
```sql
create table tags (
  id uuid primary key,                       -- Tagger stable UUID. slug/label = display only.
  type text not null check (type = 'oracle'),
  slug text not null,
  label text not null,
  description text,
  card_count integer not null default 0,     -- incl. descendants
  idf real not null default 0,               -- ln(N / card_count), normalized 0..1
  disabled boolean not null default false,   -- KILL SWITCH (survives resync: keyed by UUID)
  disabled_reason text,
  disabled_by uuid references auth.users(id),
  disabled_at timestamptz,
  content_hash bytea not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index tags_slug on tags (slug);

create table tag_edges (
  parent_id uuid not null references tags(id) on delete cascade,
  child_id  uuid not null references tags(id) on delete cascade,
  primary key (parent_id, child_id)
);
create index tag_edges_child on tag_edges (child_id);

create table tag_closure (                   -- rebuilt after each tag sync
  ancestor_id uuid not null,
  descendant_id uuid not null,
  depth smallint not null,                   -- 0 = self
  primary key (ancestor_id, descendant_id)
);
create index tag_closure_desc on tag_closure (descendant_id) include (ancestor_id, depth);

create table card_tags (                     -- direct taggings only (as in bulk file)
  card_id integer not null references cards(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  weight_raw text not null,                  -- raw type confirmed in Phase 0
  weight real not null check (weight between 0 and 1),
  primary key (card_id, tag_id)
);
create index card_tags_tag on card_tags (tag_id) include (card_id, weight);

create materialized view card_tag_vectors as -- GIN prefilter for candidate generation
select ct.card_id,
       array_agg(distinct ct.tag_id)      as direct_tag_ids,
       array_agg(distinct tc.ancestor_id) as expanded_tag_ids
from card_tags ct join tag_closure tc on tc.descendant_id = ct.tag_id
group by ct.card_id;
create unique index on card_tag_vectors (card_id);
create index card_tag_vectors_gin on card_tag_vectors using gin (expanded_tag_ids);
```
Closure rebuild (recursive CTE, cycle-safe because Tagger is community data):
```sql
insert into tag_closure_new
with recursive walk(ancestor_id, descendant_id, depth) as (
  select id, id, 0 from tags where deleted_at is null
  union all
  select w.ancestor_id, e.child_id, w.depth + 1
  from walk w join tag_edges e on e.parent_id = w.descendant_id
  where w.depth < 12
) cycle descendant_id set is_cycle using path
select ancestor_id, descendant_id, min(depth) from walk where not is_cycle group by 1, 2;
```
The kill switch is applied **at query time** (join `tags where not disabled`) so it takes effect immediately without a matview refresh, then `revalidateTag('tags')`. Disable options: this tag only, or this tag + descendants (via closure).

### 1.3 Sync tracking & config
```sql
create type sync_job as enum ('scryfall_catalog','oracle_tags','archidekt_crawl','corpus_aggregate','precon_import','vote_aggregate');
create type sync_status as enum ('running','succeeded','skipped_unchanged','failed','failed_sanity','abandoned');

create table sync_runs (
  id bigint generated always as identity primary key,
  job sync_job not null,
  status sync_status not null default 'running',
  source_uri text,
  source_updated_at timestamptz,             -- bulk-data updated_at; gate for next run
  worker_id text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read bigint not null default 0,
  rows_changed bigint not null default 0,
  checkpoint jsonb,
  metrics jsonb,                             -- counts compared by sanity gates
  error text
);
create unique index sync_runs_one_running on sync_runs (job) where status = 'running';
create index sync_runs_job_recent on sync_runs (job, started_at desc);

create table app_config (                    -- weights, thresholds, anti-abuse (public repo ⇒ not in code)
  key text primary key, value jsonb not null,
  is_public boolean not null default false, updated_at timestamptz not null default now()
);
create unlogged table rate_limit_hits (key text not null, window_start timestamptz not null, hits integer not null,
  primary key (key, window_start));
create table audit_log (id bigint generated always as identity primary key, actor uuid, action text not null,
  payload jsonb, created_at timestamptz not null default now());
```

### 1.4 Corpus (first-party + third-party in one aggregation)
```sql
create table commander_keys (                -- single commander or partner pair
  id integer generated always as identity primary key,
  commander_1 integer not null references cards(id),
  commander_2 integer references cards(id),
  color_identity smallint not null,
  slug text not null unique,
  check (commander_2 is null or commander_1 < commander_2)
);
create unique index commander_keys_pair on commander_keys (commander_1, coalesce(commander_2, 0));

create type deck_source as enum ('archidekt','moxfield','user','precon');
create type deck_section as enum ('commander','main','sideboard','maybeboard','companion');

create table decks (
  id bigint generated always as identity primary key,
  source deck_source not null,
  source_deck_id text,
  owner_id uuid references auth.users(id) on delete cascade,
  commander_key_id integer references commander_keys(id),
  name text not null default '',
  is_public boolean not null default false,
  include_in_corpus boolean not null default false,   -- set by worker only
  exclusion_reason text,                              -- illegal|size|unresolved|precon_copy|near_duplicate
  source_updated_at timestamptz,
  fetched_at timestamptz,
  card_count smallint not null default 0,
  content_hash bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((source = 'user') = (owner_id is not null)),
  check (source = 'user' or source_deck_id is not null)
);
create unique index decks_source_ref on decks (source, source_deck_id) where source <> 'user';
create index decks_owner  on decks (owner_id) where owner_id is not null;
create index decks_corpus on decks (commander_key_id) where include_in_corpus and deleted_at is null;

create table deck_cards (
  deck_id bigint not null references decks(id) on delete cascade,
  card_id integer not null references cards(id),
  section deck_section not null,
  quantity smallint not null check (quantity > 0),
  primary key (deck_id, section, card_id)
);
create index deck_cards_card on deck_cards (card_id) where section in ('commander','main');

create table crawl_queue (
  source deck_source not null,
  source_deck_id text not null,
  listed_updated_at timestamptz,
  status text not null default 'pending' check (status in ('pending','leased','done','gone','quarantined')),
  attempts smallint not null default 0,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  primary key (source, source_deck_id)
);
create index crawl_queue_ready on crawl_queue (next_attempt_at) where status = 'pending';

create table crawl_targets (
  source deck_source not null,
  commander_card_id integer not null references cards(id),
  priority integer not null,
  newest_seen_at timestamptz,
  decks_listed integer not null default 0,
  last_listed_at timestamptz,
  primary key (source, commander_card_id)
);

-- Aggregates: rebuilt nightly by worker (build _new, rename in txn). No FKs.
create table commander_stats (
  commander_key_id integer primary key,
  deck_count integer not null,
  source_counts jsonb not null,              -- {"archidekt": 812, "user": 14}
  role_profile jsonb not null,               -- avg cards per top-level tag, for cut/add role gaps
  computed_at timestamptz not null
);
create table card_global_stats (
  card_id integer primary key,
  decks_with integer not null,
  eligible_decks integer not null,           -- corpus decks whose identity ⊇ card identity
  rate real not null,                        -- p0 baseline
  computed_at timestamptz not null
);
create table commander_card_stats (
  commander_key_id integer not null,
  card_id integer not null,
  decks_with integer not null,
  inclusion_shrunk real not null,            -- (x + α·p0)/(n + α)
  synergy real not null,                     -- inclusion_shrunk − p0
  primary key (commander_key_id, card_id)
);
create index ccs_synergy   on commander_card_stats (commander_key_id, synergy desc);
create index ccs_inclusion on commander_card_stats (commander_key_id, inclusion_shrunk desc);
```

### 1.5 User data
```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  trust_weight real not null default 0.2 check (trust_weight between 0 and 1),
  is_admin boolean not null default false,
  vote_banned boolean not null default false,
  created_at timestamptz not null default now()
);

create table collection_items (              -- printing level
  user_id uuid not null references auth.users(id) on delete cascade,
  printing_id uuid not null references printings(id),
  finish text not null check (finish in ('nonfoil','foil','etched')),
  condition text not null default 'NM',
  lang text not null,
  quantity integer not null check (quantity > 0),
  import_id bigint,
  updated_at timestamptz not null default now(),
  primary key (user_id, printing_id, finish, condition, lang)
);
create table collection_cards (              -- oracle-level rollup, recomputed per user at import commit
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id integer not null references cards(id),
  quantity integer not null,
  primary key (user_id, card_id)
);
create table collection_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_app text not null,
  mode text not null check (mode in ('replace','merge')),
  status text not null check (status in ('open','committed','failed')),
  rows_total integer not null default 0,
  rows_unresolved integer not null default 0,
  unresolved_sample jsonb,
  created_at timestamptz not null default now()
);

create table favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('card','commander','deck')),
  ref_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

create table votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_card_id integer not null references cards(id),      -- ≡ target_oracle_id
  replacement_card_id integer not null references cards(id), -- ≡ replacement_oracle_id
  value smallint not null check (value in (-1, 1)),
  commander_key_id integer references commander_keys(id),   -- context, not in key
  weight real not null,                                      -- trust_weight at cast time
  ip_hash bytea,                                             -- salted, salt rotated monthly
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, target_card_id, replacement_card_id),
  check (target_card_id <> replacement_card_id)
);
create index votes_pair on votes (target_card_id, replacement_card_id);
create index votes_user_recent on votes (user_id, updated_at desc);

create table pair_vote_stats (               -- refreshed every 10 min
  target_card_id integer not null,
  replacement_card_id integer not null,
  up_weighted real not null, down_weighted real not null,
  up_count integer not null, down_count integer not null,
  frozen boolean not null default false,     -- anomaly job freezes to pre-spike snapshot
  computed_at timestamptz not null,
  primary key (target_card_id, replacement_card_id)
);
```

### 1.6 RLS
There is no Supabase anonymous auth, so an anonymous visitor is the `anon` role with no `auth.uid()`.
```sql
-- Public reference data: read for all; writes only by service role (bypasses RLS).
do $$ declare t text; begin
  foreach t in array array['formats','cards','card_names','printings','tags','tag_edges','tag_closure','card_tags',
    'commander_keys','commander_stats','card_global_stats','commander_card_stats','pair_vote_stats','slug_redirects']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy public_read on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
revoke all on card_tag_vectors from anon, authenticated;   -- matview: only via security-definer rec functions

-- Service-only: RLS on, zero policies
alter table sync_runs enable row level security;   -- likewise crawl_queue, crawl_targets, app_config,
                                                   -- rate_limit_hits, audit_log

-- Decks: only first-party decks are ever readable. Third-party decklists never exposed.
alter table decks enable row level security;
create policy decks_read on decks for select to anon, authenticated
  using (source = 'user' and deleted_at is null and (is_public or owner_id = (select auth.uid())));
create policy decks_write on decks for all to authenticated
  using (source = 'user' and owner_id = (select auth.uid()))
  with check (source = 'user' and owner_id = (select auth.uid()));
revoke insert, update on decks from authenticated;
grant insert (source, owner_id, name, is_public, commander_key_id),
      update (name, is_public, commander_key_id, deleted_at, updated_at) on decks to authenticated;

alter table deck_cards enable row level security;
create policy deck_cards_read on deck_cards for select to anon, authenticated
  using (exists (select 1 from decks d where d.id = deck_id and d.source = 'user' and d.deleted_at is null
                 and (d.is_public or d.owner_id = (select auth.uid()))));
create policy deck_cards_write on deck_cards for all to authenticated
  using      (exists (select 1 from decks d where d.id = deck_id and d.owner_id = (select auth.uid())))
  with check (exists (select 1 from decks d where d.id = deck_id and d.owner_id = (select auth.uid())));

-- Owner-only (same pattern for collection_cards, collection_imports, favorites)
alter table collection_items enable row level security;
create policy own_all on collection_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table profiles enable row level security;
create policy own_read on profiles for select to authenticated using (id = (select auth.uid()));
create policy own_update on profiles for update to authenticated using (id = (select auth.uid()));
revoke update on profiles from authenticated; grant update (display_name) on profiles to authenticated;

-- Votes: read own; NO write policies. Writes only via cast_vote() SECURITY DEFINER
-- (eligibility, rate limit, trust weight, ip hash).
alter table votes enable row level security;
create policy own_read on votes for select to authenticated using (user_id = (select auth.uid()));
```
Admin (tag kill switch, sync status): server-side service client after a `profiles.is_admin` check, with each change logged to `audit_log`.

### 1.7 Hot paths: matviews & caching
| Query | Strategy |
|---|---|
| Swap candidates | SQL fn `rec_swap_features(target, identity, exclude[], allow_gc, owned[] \| use_account, commander_key, limit 400)` (security definer, `search_path=''`). GIN `expanded_tag_ids && target_expanded` prefilter, then `cards_commander_pool` gates, then tag-sim/corpus/vote features. Collection-less result cached per `(target, commander_key, allow_gc)` via `use cache` (top 60 kept); deck exclusion applied after the cache. Collection-aware: uncached, starts from the owned pool. |
| Add list | `commander_card_stats` top 500 by synergy/inclusion for the commander key. Cached per `(commander_key, allow_gc)`. Deck exclusion, ownership and category grouping done in TS. |
| Cut list | One query: deck card ids ⋈ `commander_card_stats` + `card_tags` role counts vs `commander_stats.role_profile`. Deck-specific, uncached, cheap (≤100 rows). |
| Card / commander pages | RSC `use cache` + `cacheLife('days')` + `cacheTag('card:<id>'\|'commander:<id>'\|'tags'\|'corpus'\|'prices')`. Worker hits the revalidate webhook after syncs. |
| Tag vectors / closure | Rebuilt after tag sync (closure swap, `REFRESH MATERIALIZED VIEW CONCURRENTLY`). |
| Corpus stats | Nightly rebuild + rename. |
| Vote stats | 10-min refresh. Deliberately lagged to damp manipulation. |
| Typeahead | `GET /api/cards/search?q=` Route Handler, CDN-cached 1h. |

---

## 2. Commander rules module (`packages/core/src/formats/`)
```
formats/
  types.ts          FormatRules interface (extracted from the one impl, not designed ahead)
  index.ts          export const rulesFor = (code: 'commander') => commanderRules
  commander/
    colorIdentity.ts        bitmask helpers; uses Scryfall color_identity (covers hybrid, Phyrexian, back faces, color indicators). Never recomputed.
    commanderEligibility.ts can_be_commander, partner pairing validation (all partner_kind variants)
    copyLimit.ts            basic → ∞; "any number of cards named" → ∞; "up to seven/nine" → 7/9 (parsed at ingestion into cards.copy_limit)
    legality.ts             legalities[formats.scryfall_legality_key] === 'legal'
    brackets.ts             estimateBracket(deck): GC count (0 → 2, 1–3 → 3, >3 → 4) + tag signals (mass land denial, extra-turn chaining ⇒ ≥4); "estimated" label; user override
    validateDeck.ts         DeckIssue[] (size 100, identity, singleton, legality, commander validity, GC over bracket cap). Non-blocking for pasted decks.
    gates.ts                buildGateParams(analysis, ctx) → GateParams
```
```ts
export interface FormatRules {
  code: 'commander';
  validateDeck(deck: DeckInput, cards: CardFacts[]): DeckIssue[];
  deckIdentity(commanders: CardFacts[]): number;               // bitmask
  copyLimit(card: CardFacts): number;                          // Infinity allowed
  isLegal(card: CardFacts): boolean;
  buildGateParams(analysis: DeckAnalysis, ctx: RecContext): GateParams;
}
export interface GateParams {                                  // the SQL seam
  legalityKey: string; identityMask: number; excludeCardIds: number[];
  excludeBasics: true; allowGameChangers: boolean;
  ownership: { kind: 'none' } | { kind: 'ids'; cardIds: number[] } | { kind: 'account' };
}
```
SQL rec functions consume only `GateParams` plus the precomputed columns (`legal_commander`, `color_identity`, `is_basic_land`, `game_changer`). **Adding a format later** means a new `formats/<fmt>/` folder, a `formats` row, and an expression index on `legalities->>'<fmt>'`. The rec functions stay unchanged. Nothing more is built now.

---

## 3. API contract (`packages/core/src/contract/`) — frozen at end of Phase 0
```ts
// ids.ts
export type Brand<T, B> = T & { readonly __brand: B };
export type CardId = Brand<number, 'CardId'>;            // 1:1 with oracle_id
export type OracleId = Brand<string, 'OracleId'>;
export type PrintingId = Brand<string, 'PrintingId'>;    // Scryfall card id
export type TagId = Brand<string, 'TagId'>;              // Tagger UUID
export type CommanderKeyId = Brand<number, 'CommanderKeyId'>;
export type DeckId = Brand<string, 'DeckId'>;            // bigint as string
export type IsoDateTime = string;
export type ColorIdentity = string;                      // 'WUBRG' order subset, '' = colorless
export type Bracket = 1 | 2 | 3 | 4 | 5;
export type Finish = 'nonfoil' | 'foil' | 'etched';

// errors.ts
export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'VALIDATION' | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_NOT_AUTHORIZED' | 'CATALOG_EPOCH_MISMATCH' | 'INTERNAL';
export interface ApiError { code: ErrorCode; message: string; retryAfterSec?: number; fieldErrors?: Record<string, string[]> }
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// cards.ts
export interface PriceEstimate { usd: number; finish: Finish; asOf: IsoDateTime; source: 'scryfall' }
export interface CardSummary {
  id: CardId; oracleId: OracleId; name: string; slug: string; manaValue: number; typeLine: string;
  colorIdentity: ColorIdentity; imageUri: string | null; gameChanger: boolean; released: boolean;
  price: PriceEstimate | null;
}
export interface TagRef { id: TagId; slug: string; label: string; weight?: number; depth?: number }
export interface CardFace { name: string; manaCost: string; typeLine: string; oracleText: string }
export interface CardDetail extends CardSummary {
  oracleText: string | null; layout: string; faces: CardFace[] | null;
  legalCommander: 'legal' | 'not_legal' | 'banned' | 'restricted';
  canBeCommander: boolean; tags: TagRef[]; tagAncestors: TagRef[]; scryfallUri: string;
}

// decks.ts
export type DeckSection = 'commander' | 'main' | 'sideboard' | 'maybeboard' | 'companion';
export type LineFlag = 'alchemy_mapped' | 'fuzzy' | 'ambiguous' | 'unresolved' | 'set_mismatch';
export interface ParsedLine {
  lineNo: number; raw: string; quantity: number; name: string; setCode?: string;
  collectorNumber?: string; finish?: Finish; section: DeckSection; flags: LineFlag[];
}
export type ResolveVia = 'set_cn' | 'exact' | 'front_face' | 'flavor_name' | 'alchemy_mapped' | 'fuzzy';
export type Resolution =
  | { status: 'resolved'; card: CardSummary; via: ResolveVia }
  | { status: 'ambiguous'; options: CardSummary[] }
  | { status: 'unresolved'; suggestions: CardSummary[] };
export interface ResolvedLine { line: ParsedLine; resolution: Resolution }
export interface DeckInput { commanders: CardId[]; cards: { cardId: CardId; quantity: number; section: DeckSection }[] }
export type CorpusConfidence = 'none' | 'low' | 'full';        // n < N_min | N_min ≤ n < N_full | n ≥ N_full
export interface CommanderKeyRef {
  id: CommanderKeyId | null; slug: string | null; commanders: CardSummary[];
  deckCount: number; confidence: CorpusConfidence;
}
export type DeckIssueCode = 'NOT_LEGAL' | 'OUTSIDE_COLOR_IDENTITY' | 'SINGLETON_VIOLATION' | 'WRONG_DECK_SIZE'
  | 'INVALID_COMMANDER' | 'INVALID_PARTNER_PAIR' | 'OVER_BRACKET_GC_LIMIT' | 'MISSING_COMMANDER';
export interface DeckIssue { code: DeckIssueCode; cardId?: CardId; message: string }
export interface DeckAnalysis {
  deck: DeckInput; colorIdentity: ColorIdentity; commanderKey: CommanderKeyRef;
  estimatedBracket: Bracket; gameChangerIds: CardId[]; issues: DeckIssue[];
  commanderCandidates?: CardSummary[];                        // when MISSING_COMMANDER
}
export interface ParseDeckResult { lines: ResolvedLine[]; analysis: DeckAnalysis | null }
export interface ImportDeckUrlResult extends ParseDeckResult { source: 'archidekt' | 'moxfield'; sourceUrl: string }
export interface SavedDeckSummary {
  id: DeckId; name: string; commanderKey: CommanderKeyRef; isPublic: boolean; cardCount: number; updatedAt: IsoDateTime;
}

// recs.ts
export type RecMode = 'collection_less' | 'collection_aware';
export type OwnershipInput =
  | { kind: 'session'; catalogEpoch: string; ownedCardIds: CardId[] }   // IndexedDB
  | { kind: 'account' };
export interface RecContext {
  deck: DeckInput; bracket: Bracket; bracketSource: 'inferred' | 'user';
  includeGameChangers: boolean; ownership: OwnershipInput | null;
}
export type ScoreComponent = 'tag' | 'manaValue' | 'corpus' | 'votes';
export interface ScoreBreakdown {
  total: number;                                               // 0..1
  components: Record<ScoreComponent, number | null>;          // null = unavailable
  effectiveWeights: Record<ScoreComponent, number>;           // after renormalization
}
export interface TagMatch { targetTag: TagRef; candidateTag: TagRef; via: TagRef | null; distance: number }
export interface CorpusEvidence { decksWith: number; commanderDeckCount: number; inclusionRate: number; synergy: number }
export interface VoteSummary { score: number; voteCount: number; myVote: -1 | 0 | 1 | null }
export type CostBasis = 'buy_replacement_vs_buy_target' | 'owned_replacement' | 'both_owned' | 'price_unavailable';
export interface CostDelta { usd: number | null; basis: CostBasis; asOf: IsoDateTime | null }
export interface OwnedInfo { quantity: number }
export interface SwapSuggestion {
  card: CardSummary; score: ScoreBreakdown; matchedTags: TagMatch[]; corpus: CorpusEvidence | null;
  votes: VoteSummary; costDelta: CostDelta; owned: OwnedInfo | null;
}
export interface SwapResult {
  mode: RecMode; target: CardSummary; confidence: CorpusConfidence; suggestions: SwapSuggestion[];
  emptyReason?: 'NO_TAGS_ON_TARGET' | 'NOTHING_OWNED_FITS' | 'NO_CANDIDATES';
}
export type CardCategory = 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'planeswalker' | 'battle' | 'land';
export interface AddSuggestion {
  card: CardSummary; category: CardCategory; score: ScoreBreakdown; corpus: CorpusEvidence | null;
  fillsRoles: TagRef[]; owned: OwnedInfo | null;
}
export interface AddResult {
  mode: RecMode; commanderKey: CommanderKeyRef; confidence: CorpusConfidence;
  groups: { category: CardCategory; suggestions: AddSuggestion[] }[];
}
export type CutReason = 'NOT_LEGAL' | 'OUTSIDE_COLOR_IDENTITY' | 'LOW_SYNERGY' | 'ROLE_REDUNDANT'
  | 'GAME_CHANGER_EXCLUDED' | 'OVER_BRACKET_GC_LIMIT' | 'HIGH_MANA_VALUE' | 'NOT_OWNED';
export interface CutSuggestion {
  card: CardSummary; cutScore: number; reasons: CutReason[]; corpus: CorpusEvidence | null; owned: OwnedInfo | null;
}
export interface CutResult { mode: RecMode; confidence: CorpusConfidence; suggestions: CutSuggestion[] }

// collection.ts
export type SourceApp = 'manabox' | 'moxfield' | 'tcgplayer' | 'generic_csv' | 'generic_json' | 'text';
export interface CollectionRowInput {
  rowNo: number; name?: string; scryfallId?: string; tcgplayerId?: number; setCode?: string;
  collectorNumber?: string; lang?: string; finish?: Finish; condition?: string; quantity: number;
}
export interface ResolvedCollectionRow {
  rowNo: number; printingId: PrintingId | null; cardId: CardId; finish: Finish; condition: string;
  lang: string; quantity: number; via: 'scryfall_id' | 'tcgplayer_id' | 'set_cn_lang' | 'set_cn' | 'name_only';
}
export interface UnresolvedCollectionRow { rowNo: number; input: CollectionRowInput; reason: 'NOT_FOUND' | 'AMBIGUOUS' | 'INVALID' }
export interface ResolveCollectionResult { catalogEpoch: string; resolved: ResolvedCollectionRow[]; unresolved: UnresolvedCollectionRow[] }
export interface CollectionTotals { uniqueCards: number; totalQuantity: number; updatedAt: IsoDateTime }

// votes/favorites/admin
export type FavoriteKind = 'card' | 'commander' | 'deck';
export type ExportFormat = 'text' | 'arena' | 'moxfield' | 'archidekt_csv';
export interface TagAdminRow { tag: TagRef; cardCount: number; disabled: boolean; disabledReason: string | null; disabledAt: IsoDateTime | null }
export interface SyncStatusRow { job: string; status: string; startedAt: IsoDateTime; finishedAt: IsoDateTime | null; rowsChanged: number; error: string | null }

// transport.ts — FE builds against this; lib/api picks real vs mock (NEXT_PUBLIC_USE_MOCKS)
export interface RecsApi {                          // Route Handlers: POST /api/recs/{swap,add,cut} (parallel, WAF-rate-limited)
  swap(input: { context: RecContext; targetCardId: CardId; limit?: number }): Promise<Result<SwapResult>>;
  add(input: { context: RecContext; limitPerCategory?: number }): Promise<Result<AddResult>>;
  cut(input: { context: RecContext; limit?: number }): Promise<Result<CutResult>>;
}
export interface ActionsApi {                       // Server Actions (mutations / user-triggered)
  parseDeck(input: { text: string }): Promise<Result<ParseDeckResult>>;                      // ≤ 20 KB
  importDeckFromUrl(input: { url: string }): Promise<Result<ImportDeckUrlResult>>;
  analyzeDeck(input: { deck: DeckInput }): Promise<Result<DeckAnalysis>>;
  resolveCollectionRows(input: { rows: CollectionRowInput[] }): Promise<Result<ResolveCollectionResult>>; // ≤ 2,000 rows/call
  saveCollectionBatch(input: { importId: string | null; sourceApp: SourceApp; mode: 'replace' | 'merge';
    rows: ResolvedCollectionRow[]; final: boolean }): Promise<Result<{ importId: string; totals: CollectionTotals | null }>>;
  deleteCollection(): Promise<Result<null>>;
  saveDeck(input: { deckId?: DeckId; name: string; deck: DeckInput; isPublic: boolean }): Promise<Result<{ deckId: DeckId }>>;
  deleteDeck(input: { deckId: DeckId }): Promise<Result<null>>;
  castVote(input: { targetCardId: CardId; replacementCardId: CardId; value: -1 | 0 | 1;
    commanderKeyId?: CommanderKeyId }): Promise<Result<VoteSummary>>;
  setFavorite(input: { kind: FavoriteKind; refId: string; on: boolean }): Promise<Result<null>>;
  exportDeck(input: { deckId: DeckId; format: ExportFormat }): Promise<Result<{ filename: string; content: string }>>;
  adminSetTagDisabled(input: { tagId: TagId; disabled: boolean; reason: string; includeDescendants: boolean }): Promise<Result<{ affected: TagId[] }>>;
}
export interface DataApi {                          // RSC read functions ('use cache' where public)
  getCardBySlug(slug: string): Promise<CardDetail | null>;
  getCardAlternatives(slug: string, opts?: { commanderSlug?: string }): Promise<SwapResult | null>;
  getCommanderBySlug(slug: string): Promise<{ key: CommanderKeyRef; top: AddResult;
    roleProfile: { tag: TagRef; avgPerDeck: number }[]; computedAt: IsoDateTime } | null>;
  searchCards(q: string, opts?: { commanderEligible?: boolean; limit?: number }): Promise<CardSummary[]>;
  getMySavedDecks(): Promise<SavedDeckSummary[]>;
  getMyCollectionTotals(): Promise<CollectionTotals | null>;
  getMyFavorites(): Promise<{ kind: FavoriteKind; refId: string }[]>;
  adminListTags(q?: string): Promise<TagAdminRow[]>;
  adminSyncStatus(): Promise<SyncStatusRow[]>;
}
```
Every Server Action and Route Handler: zod-validate the input (schemas in `contract/schemas.ts`), check auth, then rate-limit via `check_rate_limit(key, limit, window)`.

---

## 4. Recommendation engine
Pipeline for every surface: **candidate generation → hard gates (SQL) → raw features (SQL) → normalize + blend (`packages/core/scoring`, unit-testable, shared with the regression harness) → relevance floor → explanation.**

**Hard gates** (from `GateParams`): `legal_commander='legal'`; `(color_identity & ~deckMask) = 0`; not in deck; not basic land; `allowGameChangers || not game_changer`; collection-aware ⇒ owned qty ≥ required copies. Unreleased preview cards pass but get a badge and no price.

**Normalized components (each 0..1):**
- **tag**: for each direct target tag T (weight wₜ, idf) find the best candidate tag U: `wₜ·w_c·λ^d`. d = 0 for an exact match, otherwise distance via nearest shared ancestor (d ≤ 4, λ = 0.5). Ancestors with idf below `min_idf` are ignored, so over-broad parents like `removal` can't match everything. Score = `Σ best(T)·idf(T) / Σ wₜ·idf(T)` (weighted coverage of the target's roles; bounded by construction). Disabled tags are excluded at query time.
- **manaValue**: `exp(−|mv_c − mv_t| / 1.5)`.
- **corpus**: shrunk rate `p̂ = (x + α·p0)/(n + α)`, α = 20, p0 = `card_global_stats.rate`. Uses **both** synergy and inclusion: `0.6·(0.5 + 0.5·clip((p̂ − p0)/0.3, −1, 1)) + 0.4·sqrt(p̂)`. Synergy corrects the staple bias; inclusion keeps proven staples. Cards released < 60 days ago get a neutral 0.5 (not enough time to appear in decks).
- **votes**: Bayesian average `(up_w + m·μ)/(up_w + down_w + m)`, m = 10, μ = global weighted up-ratio, floored at 0.5. Zero votes ⇒ μ, never 0.

**Blend** (weighted sum, never multiplied): `S = Σ wₖ·fₖ / Σ wₖ` over available components.
- Corpus weight ramps with commander deck count n: `w_corpus = W_c · clamp((n − N_min)/(N_full − N_min), 0, 1)`. **N_min = 50, N_full = 300** as priors, finalized in Phase 0 by bootstrap (smallest n where median Spearman ρ of the top-50 over resamples is ≥ 0.8). Below N_min ⇒ confidence `none`, UI "Based on card function — only n decks". For partner pairs below N_min: blend each partner's single-commander stats, weighted by their deck counts, labelled `low`.
- Vote weight ramps with pair vote count v: `w_votes = W_v · v/(v + 25)`.
- Defaults (in `app_config`, tuned against the regression set):

  | Surface | tag | mv | corpus | votes (max) |
  |---|---|---|---|---|
  | Swap, collection-less | 0.45 | 0.10 | 0.30 | 0.15 |
  | Swap, collection-aware | 0.60 | 0.10 | 0.20 | 0.10 |

**Relevance floor (swap):** tag < 0.25 ⇒ excluded. Collection-aware with nothing above the floor ⇒ `NOTHING_OWNED_FITS`. A target with no tags ⇒ fallback candidates share a primary card type, ranked by mv + corpus, `emptyReason`-style banner "No functional tags for this card".

**Add list:** candidates = `commander_card_stats` top 500 (gated). Score = 0.7·corpus + 0.3·roleGap, where roleGap = how much the card's top-level tags fill roles the deck is short on vs `commander_stats.role_profile`. Below N_min: candidates = cards sharing tags with the deck's tag centroid (top 30 tags by weight), scored 0.7·tagCentroidSim + 0.3·sqrt(p0). Grouped by `CardCategory`.

**Cut list:** for each non-commander, non-basic card, `cutScore` = 0.5·(1 − corpus) + 0.3·roleRedundancy (deck count of the card's best role ÷ the commander's role profile, clipped) + 0.2·mvOutlier. Hard reasons (`NOT_LEGAL`, `OUTSIDE_COLOR_IDENTITY`, `GAME_CHANGER_EXCLUDED`, `OVER_BRACKET_GC_LIMIT`) pin to the top. Collection-aware adds `NOT_OWNED` as a filterable reason. Clicking a card opens the swap drawer.

**Cost delta:** collection-less `usd = ref(replacement) − ref(target)`; owned replacement ⇒ `−ref(target)`, basis `owned_replacement`; both owned ⇒ 0. Hidden if `prices_as_of` > 36h old.

**Scryfall `edhrec_rank` is never used** (competitor-derived; same reasoning as Tier 3).

---

## 5. Import & parsing (`packages/core/src/parse/`)
**Decklist grammar per line:** `[qty][x] name [(SET) [cn]] [*F*|*E*] [[Category]|#tag]`. Section headers (case-insensitive, optional `:`/`//`): Commander(s), Deck/Main/Mainboard, Sideboard, Maybeboard/Considering, Companion. Arena/MTGO convention (commander block separated by a blank line) is inferred. Also handles CRLF, BOM, tabs, quantity-0 lines. Limits: 20 KB, 400 lines.

**Resolution order:**
1. set + cn → printing
2. exact normalized full name
3. front-face name (DFC/adventure/split half)
4. flavor/printed name (UB/Universes Within)
5. `A-` prefix → paper card, flag `alchemy_mapped`
6. trigram ≥ 0.8 → `fuzzy`, user confirms

Ingestion drops non-playable layouts (tokens, art series, emblems, planar, schemes, vanguard). If still >1 oracle id: prefer commander-legal → non-digital → most recent. Otherwise return `ambiguous` with options and the UI shows a picker. No commander found ⇒ `MISSING_COMMANDER` + eligible candidates from the list.

**Collections:** detect format by CSV header (ManaBox / Moxfield / TCGplayer / generic). Parse in a browser **Web Worker**, then resolve via `resolveCollectionRows` in 2k-row batches: scryfallId → tcgplayerId → set+cn+lang → set+cn → name-only. Limits: 5 MB file, 50k rows. **Real export samples from each app are required as fixtures before Phase 3 starts.**
- **Anonymous:** resolved rows go to IndexedDB (`idb`): stores `collection_rows`, `current_deck`, `meta{catalogEpoch, expiresAt}`. Recs send `ownedCardIds` (int ids, ~30–50 KB for 10k unique cards). An epoch mismatch ⇒ re-resolve from stored printing ids.
- **Migration on signup:** non-blocking prompt shown after results render → OAuth/magic link (same-origin IndexedDB survives redirect and new tab) → `/collection?migrate=1` → "Save your N cards?" → `saveCollectionBatch` in chunks (merge) → commit recomputes `collection_cards` for the user → IndexedDB cleared. Different device ⇒ explain and offer re-import.

**Archidekt URL import:** Server Action → shared HTTP client → zod-validated response. Moxfield: text/CSV import only (API requires authentication). URL import disabled by default in `share_import_sources`.

---

## 6. Ingestion worker (`apps/worker`)
**Shared HTTP client:**
- Sends `User-Agent: MTGDeckRec/<ver> (+https://<domain>/about; <contact email>)` and `Accept: application/json;q=0.9,*/*;q=0.8` on every request.
- Per-host token bucket: api.scryfall.com ≥100 ms; archidekt.com 1 req/s, concurrency 1 (forum-reported limit ~80/min).
- Exponential backoff + jitter on 429/5xx; honors `Retry-After`.
- Circuit breaker: 5 consecutive 429s ⇒ 15-min pause; 3 trips ⇒ run fails and alerts.
- No UA rotation, no proxies, no bypass libraries (enforced by a CI dependency denylist check).

**Jobs:**

`scryfall_catalog` (GH Actions, 2×/day)
1. Read the bulk index. Skip if `updated_at` == last succeeded run.
2. Stream `oracle_cards.jsonl.gz` + `all_cards.jsonl.gz` (gunzip → line split → zod) and COPY into run-scoped **unlogged staging tables**. Heartbeat every 10k lines.
3. **Sanity gate:** row counts within ±5% of the previous run and parse errors < 0.1%; otherwise `failed_sanity`.
4. **One transaction:** upsert `ON CONFLICT … WHERE content_hash IS DISTINCT FROM`, soft-delete missing rows, always update price columns, recompute derived columns (reference price, copy_limit, partner kind, can_be_commander, card_names).
5. Drop staging, hit the revalidate webhook.

`oracle_tags` (GH Actions, daily)
1. Same gating/staging pattern.
2. **Sanity gate:** taggings ≥ 80% and tags ≥ 90% of the previous run. Otherwise keep old data and alert.
3. Upsert tags by UUID (preserving `disabled`), replace edges/card_tags for changed tags, rebuild closure (recursive CTE) + idf, refresh `card_tag_vectors` concurrently, `revalidateTag('tags')`.

`archidekt_crawl` (always-on container)
1. Targets are self-derived: sample the newest public decks ⇒ commander frequency ⇒ top N, widening over time.
2. List per commander, newest-first, until `updatedAt ≤ newest_seen_at` or a per-commander cap (2,000). Enqueue.
3. Leased queue workers fetch `/api/decks/:id/`, zod-validate (shape drift ⇒ `quarantined` + alert, crawl continues), and resolve cards (Scryfall ids if present, else names).
4. Upsert deck + deck_cards in one transaction.
5. Corpus filters: legal commander(s), exactly 100 cards, in identity, ≤ 3 unresolved.
6. 404 ⇒ `gone` + soft-delete. Expired leases are re-leased, so the crawler resumes by construction.

`precon_import` (monthly): MTGJSON precon lists (verify license in Phase 1), used only to dedupe.

`corpus_aggregate` (nightly, after crawl)
1. Exclude decks with Jaccard ≥ 0.85 vs a precon for the same commander, and near-duplicates ≥ 0.95 (MinHash in the worker).
2. Compute identity-bucket eligible counts (32 buckets), `card_global_stats`, `commander_card_stats`, `commander_stats.role_profile`.
3. Swap tables, `revalidateTag('corpus')`.
4. Sources: `archidekt` + public `user` decks feed the same aggregation; per-source weights in `app_config`.

`vote_aggregate` (every 10 min): weighted rollup + anomaly freeze.

**Failure at 60%:** the process dies mid-stream, so staging holds a partial load and **live tables are untouched** (the merge only runs after a complete stream + sanity pass, inside one transaction). The `running` row goes stale, and the next invocation marks `abandoned` if `heartbeat_at` is more than 15 min old, drops orphan staging tables, and re-downloads (bulk downloads are cheap; resuming mid-gzip isn't worth it). A death mid-merge rolls back the transaction, with the same outcome. The crawler resumes from the queue. Max data staleness is surfaced in the UI: prices older than 36h ⇒ cost delta hidden; corpus `computed_at` shown on commander pages.

**Supabase connections from the worker:** Supavisor **session mode** (IPv4, supports COPY). Never the direct connection from GH runners.

---

## 7. Directory structure
```
mtg-deck-rec/
├─ package.json                 # yarn 4 workspaces; .yarnrc.yml nodeLinker: node-modules
├─ docker-compose.yml           # web + worker dev containers; Supabase via `supabase start`
├─ apps/
│  ├─ web/
│  │  ├─ next.config.ts         # cacheComponents: true
│  │  └─ src/
│  │     ├─ proxy.ts            # Supabase session refresh (Next 16 replaces middleware.ts)
│  │     ├─ app/
│  │     │  ├─ layout.tsx       # grid shell with reserved <AdSlot/> positions (render null in POC)
│  │     │  ├─ page.tsx         # landing + paste box
│  │     │  ├─ (public)/card/[slug]/page.tsx
│  │     │  ├─ (public)/card/[slug]/alternatives/page.tsx
│  │     │  ├─ (public)/commander/[slug]/page.tsx
│  │     │  ├─ sitemap.ts · robots.ts
│  │     │  ├─ (tool)/deck/page.tsx            # noindex; Add / Cut tabs + Swap drawer
│  │     │  ├─ (tool)/collection/page.tsx      # import, anon (IndexedDB) or account
│  │     │  ├─ (account)/decks/… · favorites/ · settings/
│  │     │  ├─ (auth)/login/page.tsx · auth/callback/route.ts
│  │     │  ├─ admin/tags/page.tsx · admin/sync/page.tsx
│  │     │  └─ api/recs/{swap,add,cut}/route.ts · api/cards/search/route.ts · api/internal/revalidate/route.ts
│  │     ├─ actions/            # deck.ts collection.ts decks.ts votes.ts favorites.ts admin.ts
│  │     ├─ lib/data/           # DataApi impl ('use cache' + cacheTag)
│  │     ├─ lib/api/            # real vs mock switch for RecsApi/ActionsApi/DataApi
│  │     ├─ lib/supabase/       # server.ts, service.ts (server-only), browser.ts
│  │     ├─ lib/session-store/  # IndexedDB schema, TTL, migration
│  │     ├─ workers/            # collection-parse.worker.ts
│  │     └─ components/         # ui/ (shadcn), cards/, deck/, recs/, layout/AdSlot.tsx
│  │  └─ e2e/                   # Playwright
│  └─ worker/
│     ├─ Dockerfile
│     └─ src/
│        ├─ cli.ts              # sync:catalog | sync:tags | crawl:archidekt | aggregate:corpus | aggregate:votes | import:precons
│        ├─ jobs/
│        ├─ lib/                # http.ts jsonl.ts pg-copy.ts sync-runs.ts sanity.ts revalidate.ts minhash.ts
│        └─ sources/archidekt/  # client.ts schemas.ts (zod drift detection)
├─ packages/core/src/
│  ├─ contract/                 # types + zod schemas + mocks/
│  ├─ formats/                  # §2
│  ├─ parse/                    # normalize.ts decklist/ collection/{manabox,moxfield,tcgplayer,generic,detect}.ts
│  ├─ scoring/                  # components.ts blend.ts swap.ts add.ts cut.ts bayes.ts
│  └─ fixtures/                 # decklists/ collections/ rec-regression/ catalog-snapshot/
├─ supabase/                    # config.toml migrations/ seed.sql tests/*.test.sql (pgTAP)
├─ spikes/                      # Phase 0 throwaway; deleted at Phase 0 exit
├─ docs/                        # spikes/ permissions/ decisions/
└─ .github/workflows/           # ci.yml sync-catalog.yml sync-tags.yml rec-regression-live.yml
```

---

## 8. Phased roadmap (durations are estimates)

### Phase 0 — Spike (weeks 1–2)
- **BE:**
  - Send the Moxfield / Archidekt / Scryfall emails on day 1.
  - Tag spike: load Oracle Cards + Oracle Tags into local Postgres. Profile weight type/distribution, hierarchy depth, cycles, and % of commander-legal non-land cards with ≥1 tag. Implement naive tag-sim SQL.
  - Corpus spike: crawl the top ~50 commanders at 1 req/s. Measure qualifying decks per commander, working list params, whether deck payloads carry Scryfall ids, 429 behavior, decks/hour. Bootstrap stability ⇒ N_min/N_full.
- **FE:**
  - Draft contract v0 with BE, plus mocks and fixtures.
  - Tailwind v4 + shadcn setup.
  - Wireframes: deck tool (Add/Cut/Swap, bracket selector, GC toggle, confidence banner), card page, commander page with ad-slot grid.
  - **Blind rater tool** for the tag eval (randomized candidates from spike JSON).
- **Tag eval protocol:** 50 substitution cases × 5 commanders (spread of identities/archetypes), no ownership filter. Two raters, blind. Metric: precision@5 + MRR, run tag-only in week 1 and tag+corpus blend in week 2.
- **Kill criteria:**
  - *Tag approach:* fewer than 60% of cases have ≥3/5 acceptable, **or** fewer than 70% of commander-legal non-land cards carry ≥1 tag. Fallback: swaps become corpus-co-occurrence-based for commanders ≥ N_min only; no long-tail swaps.
  - *Archidekt:* more than half of the top-50 commanders have < 50 qualifying decks, **or** sustained throughput < 20k decks/day, **or** ρ < 0.8 at n = 300. Fallback: ship tag-only (`confidence: 'none'`) + grow first-party corpus; Moxfield/Scryfall as upside.
- **DoD:** `docs/spikes/phase0.md` with the numbers and go/no-go; N_min/N_full/λ/initial weights recorded; **contract v1 frozen** (later changes need a PR approved by both devs); CLAUDE.md updated with real commands.

### Phase 1 — Data foundation + public card pages (weeks 3–6)
- **BE:**
  - Migrations §1.1–1.4 + RLS for public/service tables.
  - Worker: HTTP client, `scryfall_catalog`, `oracle_tags`, closure, `archidekt_crawl` deployed to container, `precon_import`, `corpus_aggregate`.
  - GH workflows, revalidate webhook, `adminSetTagDisabled`, sync status.
  - Supabase Auth for admins only (public signup disabled).
- **FE:**
  - App shell with ad-slot-ready grid.
  - SSR `/card/[slug]`: image, oracle text, legality, tags w/ hierarchy, GC badge, price est. + as-of, Scryfall link.
  - Typeahead, sitemap/robots, `/admin/tags` kill switch, `/admin/sync`, footer (Scryfall attribution, WotC Fan Content Policy disclaimer).
- **DoD:**
  - 5 consecutive green nightly syncs.
  - Killing the worker at ~60% leaves live tables byte-identical (row count + checksum) and the next run succeeds (automated test).
  - A tag with sanity-gate-failing input is rejected.
  - Disabling a tag removes it from the card page ≤ 60s.
  - Card pages render full content in SSR HTML, appear in the sitemap, Lighthouse SEO ≥ 90.
  - Top-50 commanders have aggregated stats.

### Phase 2 — Deck tool, collection-less (weeks 7–10) — first real product slice
- **BE:**
  - Decklist parser + resolution SQL.
  - `rec_swap_features` / add / cut SQL functions, scoring blend in core, bracket estimate, GateParams.
  - `/api/recs/*` Route Handlers, `parseDeck`/`analyzeDeck`/`importDeckFromUrl` (Archidekt).
  - Rate limits, WAF rules, `getCardAlternatives`, commander page data.
  - Rec regression harness in CI.
- **FE:**
  - `/deck`: paste/URL → resolution review (ambiguous picker, unresolved list, commander picker) → Add (grouped) / Cut tabs → click card ⇒ Swap drawer with matched tags, corpus evidence, cost delta.
  - Bracket selector (inferred + override), include-GC toggle, GC badges, confidence banner with deck count.
  - Current deck persisted in IndexedDB.
  - SSR `/commander/[slug]` and `/card/[slug]/alternatives`.
- **DoD:**
  - ≥ 60 parser fixtures pass.
  - Regression precision@5 ≥ the Phase 0 blended baseline.
  - k6: p95 uncached swap < 800 ms and add/cut < 1 s at 50 rps.
  - Cached public pages TTFB p95 < 300 ms.
  - Full anonymous flow works with zero accounts (Playwright).

### Phase 3 — Accounts, collections, collection-aware mode (weeks 11–14)
- **BE:**
  - Public auth (magic link + Google/Discord OAuth) with Turnstile CAPTCHA, profiles.
  - §1.5 collection tables + RLS + pgTAP.
  - `resolveCollectionRows`, `saveCollectionBatch` (commit ⇒ `collection_cards` rollup), `deleteCollection`.
  - Ownership gate in rec functions (ids array / account join), cost-delta bases.
- **FE:**
  - Collection import page (Web Worker parse, progress, unresolved report, anonymous → IndexedDB).
  - Non-blocking signup prompt after results.
  - Migration flow.
  - Collection-aware toggle in the deck tool, owned badges, `NOTHING_OWNED_FITS` state, account settings.
- **DoD:**
  - 10k-row ManaBox fixture imports end-to-end in < 30 s.
  - Anonymous import → OAuth signup → collection present without re-upload (Playwright).
  - pgTAP proves user A can't read/write user B's collection.
  - Property test: collection-aware suggestions ⊆ owned cards.

### Phase 4 — Voting, saved decks, favorites, export, polish (weeks 15–18)
- **BE:**
  - `cast_vote()` with eligibility/rate-limit/trust weighting, `vote_aggregate` + anomaly freeze, vote term enabled in blend.
  - Saved decks (public + legal ⇒ `include_in_corpus` on next aggregate), favorites, `exportDeck`.
- **FE:**
  - Vote controls on swap suggestions (anonymous ⇒ prompt).
  - Saved decks list/editor, favorites, export modal.
  - Empty/error states, a11y pass, mobile polish.
- **DoD:**
  - Unique-vote + rate-limit tests pass.
  - Brigade simulation (20 fresh accounts upvoting one pair) moves it ≤ 2 rank positions.
  - A saved public deck appears in the next aggregate.
  - All export formats round-trip through our own parser.

---

## 9. Voting anti-abuse
- **Eligibility:** verified email or OAuth, account age ≥ 24h, not `vote_banned`. Turnstile at signup (our own bot protection).
- **Rate limits** (DB fn, thresholds in `app_config`): 60 votes/h, 300/day per user; 1 change per pair per 10 s. Plus a Vercel WAF per-IP limit on action paths.
- **Trust weight** 0.2 → 1.0 from account age, saved legal decks, non-empty collection, agreement with settled consensus. Stored on the vote at cast time.
- **Sockpuppet signals:** more than 5 accounts voting the same pair from the same salted /24 IP hash within 24h ⇒ those votes weight 0 pending review. Vote-velocity z > 4 vs the pair's 7-day baseline ⇒ pair frozen at its pre-spike snapshot + admin queue.
- **Blast radius:** votes are capped at 0.15 weight, can't bypass gates or the tag floor, and the aggregate refreshes on a 10-min lag. Public UI shows the Bayesian score, not raw counts.

---

## 10. Testing strategy
- **Parser (Vitest):** `fixtures/decklists/*.txt` + `.expected.json`. Real exports from Archidekt, Moxfield, Arena, MTGO plus hand-written cases: `Lim-Dûl's Vault`, `Jötun Grunt`, `Fire // Ice`, `Delver of Secrets` vs full DFC name, `A-` cards, `1x Sol Ring (C21) 263 *F*`, `[Ramp]` categories, CRLF/BOM/tabs, qty 0, missing commander, partner pairs.
- **Collection fixtures:** real anonymized exports per app (**needed from you**), including a 10k-row file.
- **Resolution integration:** pinned catalog snapshot (~3k tricky cards) seeded into local Supabase.
- **Rules unit tests:** identity bitmask, partner validation matrix, copy limits, bracket estimate, validateDeck.
- **Scoring property tests (fast-check):** components ∈ [0,1]; zero votes ⇒ prior; weights renormalize when corpus is null; monotonic in tag coverage.
- **Rec quality regression:** Phase 0 rated cases (grown over time) in `fixtures/rec-regression/`. CI runs against the pinned snapshot and fails on a precision@5 drop > 5 pts vs main. A separate weekly job runs on live data to catch Tagger regressions.
- **RLS (pgTAP, `supabase test db`):** a matrix per table × {anon, user A, user B}. Checks select/insert/update/delete, direct vote insert denied, third-party decks invisible, `app_config` hidden, restricted column updates denied.
- **Worker:** truncated `.jsonl.gz` fixtures, forced abort at 60% ⇒ live tables unchanged, sanity-gate rejection, Archidekt client with recorded responses + simulated 429 storm (breaker trips, no crash), dependency denylist check (no cloudscraper-class packages).
- **E2E (Playwright):** anonymous paste → add/cut/swap; anonymous import → signup → migrated; vote flow.
- **Load (k6):** rec endpoints + cached pages at 50 rps.

---

## 11. Risks & edge cases
- **Rate limits / permission:** Archidekt runs below the forum-reported limit with a breaker. If permission is withdrawn, the corpus freezes (last aggregates still served, `computed_at` shown) and ranking shifts to tags. Moxfield is contingent only.
- **Sync failures:** staging + sanity gates + heartbeat abandonment. Alerts on failed/failed_sanity. Staleness guards hide prices > 36h. GH cron is best-effort and auto-disables after 60 idle days on public repos; a health check alerts if no successful catalog run in 36h.
- **Color identity:** always Scryfall `color_identity`. Hybrid/Phyrexian count both colors; devoid doesn't remove identity; colorless commanders ⇒ mask 0 ⇒ colorless cards only; back faces count. Partner/background/friends forever/doctor pairs ⇒ union of identities, key = pair.
- **Copy-limit exceptions:** Relentless Rats-class (unlimited), Seven Dwarves (7), Nazgûl (9). Wastes and snow basics are basics.
- **Cards with no tags** (new sets while Tagger lags): type + mv + corpus fallback with a banner. Such candidates are excluded from swaps (floor) but eligible for Add.
- **Tag data quality:** kill switch, sanity gates, idf damping of broad parents, cycle-safe closure, weekly live regression run.
- **Scaling the rec query:** GIN prefilter + partial pool index + candidate cap 400. Collection-less swap/add results cached by args; deck-specific filtering after cache. Personalization kept in client islands so public pages stay CDN-cacheable. Supabase read replica if p95 degrades.
- **Unreleased preview cards:** badge, no price, not in corpus features.
- **Expensive to reverse once ads land:**
  - URL/slug scheme (`slug_redirects` table from day 1).
  - SSR-by-default public pages.
  - Keeping personalization out of cached RSC output.
  - Layout grid with reserved slot positions (reserve dimensions to avoid CLS).
  - Brand/domain name (the "MTG" trademark question).
- **Legal/compliance:**
  - Scryfall: attribution + link, image guidelines (no cropping artist/copyright lines), prices labelled estimates, no paywalling Scryfall data.
  - WotC Fan Content Policy: disclaimer in footer; verify monetization and naming terms before ads.
  - Archidekt attribution on commander pages.
  - Privacy policy (auth data, salted IP hashes); account deletion cascades collections/decks and anonymizes votes.
  - Verify MTGJSON license before `precon_import`.
- **Public repo:** anti-abuse thresholds and scoring weights live in `app_config`; secrets only in GH/Vercel/host env.

---

## Verification (end-to-end, once built)
1. `supabase start` → `yarn workspace worker sync:catalog --local` → `sync:tags` → `crawl:archidekt --limit 500` → `aggregate:corpus`; check `sync_runs` rows are `succeeded`.
2. `yarn test` (Vitest: parser, rules, scoring), `supabase test db` (pgTAP RLS), `yarn workspace worker test` (abort-at-60%, sanity gates, 429 storm).
3. `yarn rec:regress` against the pinned snapshot; compare precision@5 to baseline.
4. `yarn workspace web dev` → paste a fixture deck at `/deck` → Add/Cut tabs render, clicking a card opens the swap drawer with tags + cost delta + as-of; toggle GCs/bracket and confirm gating.
5. Import a ManaBox fixture anonymously → sign up via OAuth → confirm the collection persisted without re-upload and collection-aware suggestions are owned-only.
6. `yarn e2e` (Playwright) and `k6 run load/recs.js`; view page source of `/card/sol-ring` to confirm SSR content.
