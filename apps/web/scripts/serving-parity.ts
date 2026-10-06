/**
 * Serving parity (T055). Runs the recommendation code twice on the same inputs: through the rec_* functions and play
 * rates computed per request, then through the precompute worker's serving tables. Every difference is reported; the
 * switch (app_config.recs.servingReads) waits until the collection-less lists match exactly. Pairs no key knows and
 * owned-only swaps are reported but not gated: the first is combined from partner totals, and the design narrows the
 * second to the stored substitutes (scoring-design.md, "Swap").
 *
 * Decks: the regression fixtures, plus seeded samples built from public tables (commanders with their own decks, pairs
 * that borrow, pairs no key knows, commanders with no decks), so it runs against hosted with the publishable key too.
 *
 * It also counts each call's database requests and the waves they went out in (a wave is a set of requests sent before
 * any of them answered). On the serving path, adds, cuts, swaps and the rater must go out in one wave.
 *
 * Usage: yarn workspace @mtg/web tsx --env-file=.env.local scripts/serving-parity.ts
 *          [--decks N] [--targets N] [--seed N] [--timing] [--fixtures dir]
 * Report: <MTG_DATA_DIR or the system temp folder>/reports/serving-parity-<time>.json, never inside the repo.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { defaultIncludeGameChangers } from "@mtg/core/commander";
import type { AddResult, Bracket, CardId, CutResult, RecContext, SwapResult } from "@mtg/core/contract";
import { loadCardPage } from "../src/lib/server/card-page";
import { loadCommanderPage } from "../src/lib/server/commander-page";
import { resolveDecklist } from "../src/lib/server/deck";
import { dealRaterCards } from "../src/lib/server/rater";
import { getAddSuggestions, getCutSuggestions, getSwapSuggestions, loadSwapPool, rankSwaps, SHARED_SWAP_POOL } from "../src/lib/server/recs";
import { createClient } from "@supabase/supabase-js";
import { commanderCorpusFrom, loadCommanderCorpus, loadCorpusConfig, type CommanderKeyRow } from "../src/lib/server/corpus";
import type { Database } from "../src/lib/server/database.types";
import { overrideServingReads } from "../src/lib/server/serving";
import type { PublicClient } from "../src/lib/server/supabase";

/** Decks sampled per kind of commander (well played, thinly played, pair, pair no key knows, no decks). */
const DEFAULT_DECKS_PER_KIND = 8;
/** Sampling only: a commander with this many decks of its own stands alone (app_config.corpus.minDecks today). */
const WELL_PLAYED_DECKS = 50;
/** Swap targets per deck. */
const DEFAULT_TARGETS = 4;
const DEFAULT_SEED = 20261006;
/** A sampled deck: the commander's most played cards, then cards from further down its list, then any in its colours. */
const TOP_DECK_CARDS = 40;
const KEY_LIST_DEPTH = 400;
const DEEPER_DECK_CARDS = 40;
const FILL_DECK_CARDS = 15;
const NO_CORPUS_DECK_CARDS = 80;
/** The most played cards overall, which fill decks. */
const GLOBAL_POOL = 2000;
/** PostgREST's row cap, and how many ids one GET carries comfortably. */
const PAGE_ROWS = 1000;
const ID_CHUNK = 300;
/** A sampled collection: this share of the deck's cards and of the fill pool. */
const OWNED_DECK_SHARE = 0.4;
const OWNED_POOL_SHARE = 0.25;
/** Scores are compared to this many decimals; the two paths should agree far below it. */
const SCORE_DECIMALS = 6;
const MAX_DETAILS_PER_KIND = 40;
const CUT_LIMIT = 40;
const ADD_LIMIT = 30;
const SWAP_LIMIT = 10;
const DETAIL_CHARS = 1500;
const BRACKET: Bracket = 3;
const P50 = 0.5;
const P95 = 0.95;
/** The queries the serving path answers in one wave of database requests. */
const ONE_WAVE_KINDS = new Set(["cuts", "adds", "adds owned-only", "swaps", "swaps shared pool", "swaps owned-first", "swaps owned-only", "rater"]);

/** The requests the script's database client made during the call being measured. */
let requests: { start: number; end: number }[] = [];

const countingFetch: typeof fetch = async (input, init) => {
  const entry = { start: performance.now(), end: Number.POSITIVE_INFINITY };
  requests.push(entry);
  try {
    return await fetch(input, init);
  } finally {
    entry.end = performance.now();
  }
};

/** createPublicClient, with every request counted. */
function countingClient(): PublicClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (run with --env-file=.env.local).");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: countingFetch } });
}

/** How many waves the requests went out in: a request starting after every earlier one answered begins a new wave. */
function waves(list: readonly { start: number; end: number }[]): number {
  let count = 0;
  let answered = Number.NEGATIVE_INFINITY;
  for (const r of [...list].sort((a, b) => a.start - b.start)) {
    if (r.start >= answered) count++;
    answered = Math.max(r.start >= answered ? r.end : answered, r.end);
  }
  return count;
}

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const decksPerKind = Number(arg("--decks") ?? DEFAULT_DECKS_PER_KIND);
const targetsPerDeck = Number(arg("--targets") ?? DEFAULT_TARGETS);
const timing = process.argv.includes("--timing");

/** A 32-bit generator's outputs, divided by this, fall in [0, 1). */
const UINT32_RANGE = 2 ** 32;

/** mulberry32: a small seeded generator, so a sample can be run again. Its shifts and constants are the published ones. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}
const random = seeded(Number(arg("--seed") ?? DEFAULT_SEED));
const pick = <T>(items: readonly T[], n: number): T[] => {
  const copy = [...items];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0] as T);
  return out;
};

const round = (n: number) => Math.round(n * 10 ** SCORE_DECIMALS) / 10 ** SCORE_DECIMALS;

interface Case {
  name: string;
  /** Pairs no key knows aren't gated (see the header). */
  gated: boolean;
  commanders: number[];
  cards: number[];
}

// --- sampling ------------------------------------------------------------------------------------------------------

interface KeyInfo {
  id: number;
  commander1: number;
  commander2: number | null;
  slug: string;
  identity: number;
  decks: number;
}

async function loadKeys(db: PublicClient): Promise<KeyInfo[]> {
  const keys: KeyInfo[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await db
      .from("commander_stats")
      .select("deck_count, commander_keys!inner(id, commander_1, commander_2, slug, color_identity)")
      .order("commander_key_id")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`Loading commander keys failed: ${error.message}`);
    for (const r of data) {
      const k = r.commander_keys;
      keys.push({ id: k.id, commander1: k.commander_1, commander2: k.commander_2, slug: k.slug, identity: k.color_identity, decks: r.deck_count });
    }
    if (data.length < PAGE_ROWS) return keys;
  }
}

async function identities(db: PublicClient, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await db
      .from("cards")
      .select("id, color_identity")
      .in("id", ids.slice(i, i + ID_CHUNK))
      .eq("legal_commander", "legal")
      .eq("is_basic_land", false)
      .is("deleted_at", null);
    if (error) throw new Error(`Loading card colours failed: ${error.message}`);
    for (const r of data) out.set(r.id, r.color_identity);
  }
  return out;
}

async function globalPool(db: PublicClient): Promise<{ id: number; identity: number }[]> {
  const ids: number[] = [];
  for (let from = 0; from < GLOBAL_POOL; from += PAGE_ROWS) {
    const { data, error } = await db.from("card_global_stats").select("card_id").order("rate", { ascending: false }).range(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`Loading the most played cards failed: ${error.message}`);
    ids.push(...data.map((r) => r.card_id));
  }
  const colours = await identities(db, ids);
  return ids.flatMap((id) => (colours.has(id) ? [{ id, identity: colours.get(id) ?? 0 }] : []));
}

async function keyCards(db: PublicClient, keyId: number): Promise<number[]> {
  const { data, error } = await db
    .from("commander_card_stats")
    .select("card_id")
    .eq("commander_key_id", keyId)
    .order("inclusion_shrunk", { ascending: false })
    .limit(KEY_LIST_DEPTH);
  if (error) throw new Error(`Loading a commander's cards failed: ${error.message}`);
  return data.map((r) => r.card_id);
}

function fill(pool: readonly { id: number; identity: number }[], identity: number, n: number, taken: ReadonlySet<number>): number[] {
  return pick(
    pool.filter((c) => (c.identity & ~identity) === 0 && !taken.has(c.id)).map((c) => c.id),
    n,
  );
}

async function sampleCases(db: PublicClient): Promise<{ cases: Case[]; pool: { id: number; identity: number }[]; keys: KeyInfo[] }> {
  const [keys, pool] = await Promise.all([loadKeys(db), globalPool(db)]);
  const cases: Case[] = [];
  const deckFor = async (keyIds: number[], identity: number) => {
    const lists = await Promise.all(keyIds.map((id) => keyCards(db, id)));
    const top = new Set(lists.flatMap((l) => l.slice(0, TOP_DECK_CARDS / keyIds.length)));
    for (const id of pick(lists.flatMap((l) => l.slice(TOP_DECK_CARDS)), DEEPER_DECK_CARDS)) top.add(id);
    for (const id of fill(pool, identity, FILL_DECK_CARDS, top)) top.add(id);
    return [...top];
  };

  const solo = keys.filter((k) => k.commander2 === null);
  for (const k of pick(solo.filter((k) => k.decks >= WELL_PLAYED_DECKS), decksPerKind)) {
    cases.push({ name: `own ${k.slug}`, gated: true, commanders: [k.commander1], cards: await deckFor([k.id], k.identity) });
  }
  for (const k of pick(solo.filter((k) => k.decks < WELL_PLAYED_DECKS), decksPerKind)) {
    cases.push({ name: `thin ${k.slug}`, gated: true, commanders: [k.commander1], cards: await deckFor([k.id], k.identity) });
  }
  const pairs = keys.filter((k) => k.commander2 !== null);
  for (const k of pick(pairs, decksPerKind)) {
    cases.push({ name: `pair ${k.slug}`, gated: true, commanders: [k.commander1, k.commander2 ?? 0], cards: await deckFor([k.id], k.identity) });
  }
  // Two partners who appear in pairs but never together.
  const known = new Set(pairs.map((k) => `${k.commander1}:${k.commander2}`));
  const partners = [...new Set(pairs.flatMap((k) => [k.commander1, k.commander2 ?? 0]))];
  const best = (commander: number) =>
    keys.filter((k) => k.commander1 === commander || k.commander2 === commander).sort((a, b) => b.decks - a.decks)[0];
  for (let tries = 0, made = 0; made < decksPerKind && tries < decksPerKind * PAGE_ROWS; tries++) {
    const [a, b] = pick(partners, 2).sort((x, y) => x - y);
    if (a === undefined || b === undefined || known.has(`${a}:${b}`)) continue;
    const ka = best(a);
    const kb = best(b);
    if (!ka || !kb) continue;
    known.add(`${a}:${b}`);
    made++;
    cases.push({ name: `unknown pair ${ka.slug} + ${kb.slug}`, gated: false, commanders: [a, b], cards: await deckFor([ka.id, kb.id], ka.identity | kb.identity) });
  }
  // Commanders with no decks of their own anywhere: the baseline pool.
  const keyed = new Set(keys.flatMap((k) => [k.commander1, k.commander2 ?? 0]));
  const { data: commanders, error } = await db
    .from("cards")
    .select("id, slug, color_identity")
    .eq("can_be_commander", true)
    .eq("legal_commander", "legal")
    .is("deleted_at", null)
    .limit(PAGE_ROWS);
  if (error) throw new Error(`Loading commanders failed: ${error.message}`);
  for (const c of pick(commanders.filter((c) => !keyed.has(c.id)), decksPerKind)) {
    cases.push({ name: `no decks ${c.slug}`, gated: true, commanders: [c.id], cards: fill(pool, c.color_identity, NO_CORPUS_DECK_CARDS, new Set()) });
  }
  return { cases, pool, keys };
}

async function fixtureCases(db: PublicClient): Promise<Case[]> {
  const dir = arg("--fixtures") ?? (process.env.MTG_DATA_DIR ? path.join(process.env.MTG_DATA_DIR, "regression") : undefined);
  if (!dir || !existsSync(dir)) return [];
  const cases: Case[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const fixture = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { name: string; decklist?: string; deckFile?: string };
    const text = fixture.decklist ?? (fixture.deckFile ? readFileSync(path.resolve(dir, fixture.deckFile), "utf8") : "");
    const analysis = (await resolveDecklist(db, text)).analysis;
    if (!analysis) continue;
    cases.push({
      name: `fixture ${fixture.name}`,
      gated: true,
      commanders: [...analysis.deck.commanders],
      cards: analysis.deck.cards.filter((c) => c.section === "main").map((c) => c.cardId),
    });
  }
  return cases;
}

// --- comparing ------------------------------------------------------------------------------------------------------

const cutsShape = (r: CutResult) => ({
  confidence: r.confidence,
  cuts: r.suggestions.map((s) => ({ id: s.card.id, score: round(s.cutScore), reasons: s.reasons.join("+"), severity: s.severity, corpus: s.corpus })),
});
const addsShape = (r: AddResult) => ({
  confidence: r.confidence,
  key: r.commanderKey,
  groups: r.groups.map((g) => ({
    category: g.category,
    cards: g.suggestions.map((s) => ({ id: s.card.id, total: round(s.score.total), corpus: s.corpus, roles: s.fillsRoles.map((t) => t.id) })),
  })),
});
// The candidate tag is left out of a match: where a card has two tags equally close through the same ancestor, the old
// function kept whichever its join met first, the new one the lower id.
const swapsShape = (r: SwapResult) => ({
  confidence: r.confidence,
  empty: r.emptyReason ?? null,
  swaps: r.suggestions.map((s) => ({
    id: s.card.id,
    total: round(s.score.total),
    twin: s.functionalTwin,
    corpus: s.corpus,
    matches: s.matchedTags.map((m) => `${m.targetTag.id}>${m.via?.id ?? "-"}:${m.distance}`).sort(),
  })),
});

interface Difference {
  kind: string;
  case: string;
  detail: string;
  /** Where the two results first part, as a JSON path. */
  at: string;
  old: string;
  served: string;
}

/** The first place two results part: a path into them and the two values found there. */
function firstDifference(a: unknown, b: unknown, at = "$"): { at: string; old: unknown; served: unknown } | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const found = firstDifference(a[i], b[i], `${at}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const found = firstDifference(left[key], right[key], `${at}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return { at, old: a, served: b };
}

/** A value as the report shows it; an array that ran out on one side shows as missing. */
const show = (value: unknown) => (JSON.stringify(value) ?? "(missing)").slice(0, DETAIL_CHARS);

const parsed = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const tally = new Map<string, { compared: number; identical: number; gated: number; gatedDifferent: number }>();
const differences: Difference[] = [];
const timings = new Map<string, { old: number[]; served: number[] }>();
const rounds = new Map<string, { oldWaves: number[]; servedWaves: number[]; oldRequests: number[]; servedRequests: number[] }>();
let order = 0;

async function compare(kind: string, c: Case, detail: string, run: () => Promise<unknown>): Promise<void> {
  const outcome = async () => {
    try {
      return JSON.stringify(await run());
    } catch (err) {
      return `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  const timed = async (serving: boolean) => {
    overrideServingReads(serving);
    requests = [];
    const start = performance.now();
    const value = await outcome();
    return { value, ms: performance.now() - start, waves: waves(requests), requests: requests.length };
  };
  // Alternate which path goes first, so neither always finds the other's pages warm.
  const servedFirst = order++ % 2 === 0;
  const firstRun = await timed(servedFirst);
  const secondRun = await timed(!servedFirst);
  overrideServingReads(null);
  const served = servedFirst ? firstRun : secondRun;
  const old = servedFirst ? secondRun : firstRun;

  const t = tally.get(kind) ?? { compared: 0, identical: 0, gated: 0, gatedDifferent: 0 };
  t.compared++;
  if (c.gated) t.gated++;
  if (old.value === served.value) t.identical++;
  else {
    if (c.gated) t.gatedDifferent++;
    if (differences.filter((d) => d.kind === kind).length < MAX_DETAILS_PER_KIND) {
      const found = firstDifference(parsed(old.value), parsed(served.value));
      differences.push({
        kind,
        case: c.name,
        detail,
        at: found?.at ?? "$",
        old: show(found ? found.old : old.value),
        served: show(found ? found.served : served.value),
      });
    }
  }
  tally.set(kind, t);
  const times = timings.get(kind) ?? { old: [], served: [] };
  times.old.push(old.ms);
  times.served.push(served.ms);
  timings.set(kind, times);
  const r = rounds.get(kind) ?? { oldWaves: [], servedWaves: [], oldRequests: [], servedRequests: [] };
  r.oldWaves.push(old.waves);
  r.servedWaves.push(served.waves);
  r.oldRequests.push(old.requests);
  r.servedRequests.push(served.requests);
  rounds.set(kind, r);
}

/** The commander corpus as loadCommanderCorpus read it before it embedded the stats: keys, then their stats. */
async function legacyCommanderCorpus(db: PublicClient, commanderIds: readonly number[]) {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const idList = ids.join(",");
  const [config, keysResult] = await Promise.all([
    loadCorpusConfig(db),
    db
      .from("commander_keys")
      .select("id, slug, commander_1, commander_2, color_identity")
      .or(`commander_1.in.(${idList}),commander_2.in.(${idList})`)
      .order("id"),
  ]);
  if (keysResult.error) throw new Error(keysResult.error.message);
  const keys = keysResult.data ?? [];
  const stats = keys.length
    ? await db.from("commander_stats").select("commander_key_id, deck_count, deck_months, role_profile").in("commander_key_id", keys.map((k) => k.id))
    : { data: [], error: null };
  if (stats.error) throw new Error(stats.error.message);
  const byKey = new Map((stats.data ?? []).map((r) => [r.commander_key_id, r]));
  const rows: CommanderKeyRow[] = keys.map((k) => {
    const st = byKey.get(k.id);
    return { ...k, commander_stats: st ? { deck_count: st.deck_count, deck_months: st.deck_months, role_profile: st.role_profile } : null };
  });
  return commanderCorpusFrom(ids, rows, config);
}

const quantile = (xs: readonly number[], q: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
};

async function main(): Promise<void> {
  const db = countingClient();
  const { cases: sampled, pool, keys } = await sampleCases(db);
  const cases = [...(await fixtureCases(db)), ...sampled];
  console.log(`serving parity: ${cases.length} decks`);

  for (const [n, c] of cases.entries()) {
    const deck = {
      commanders: c.commanders as CardId[],
      cards: c.cards.map((cardId) => ({ cardId: cardId as CardId, quantity: 1, section: "main" as const })),
    };
    const context: RecContext = {
      deck,
      bracket: BRACKET,
      bracketSource: "inferred",
      includeGameChangers: defaultIncludeGameChangers(BRACKET),
      ownership: null,
    };
    const ownedIds = [...pick(c.cards, Math.round(c.cards.length * OWNED_DECK_SHARE)), ...pick(pool.map((p) => p.id), Math.round(pool.length * OWNED_POOL_SHARE))];
    const owned = (mode: "only" | "first"): RecContext => ({
      ...context,
      ownership: { kind: "session", catalogEpoch: "parity", ownedCardIds: ownedIds as CardId[] },
      ownershipMode: mode,
    });

    await compare("cuts", c, "", async () => cutsShape(await getCutSuggestions(db, { context, limit: CUT_LIMIT })));
    await compare("adds", c, "", async () => addsShape(await getAddSuggestions(db, { context, limitPerCategory: ADD_LIMIT })));
    await compare("adds owned-only", { ...c, gated: false }, "", async () =>
      addsShape(await getAddSuggestions(db, { context: owned("only"), limitPerCategory: ADD_LIMIT })),
    );
    for (const target of pick(c.cards, targetsPerDeck)) {
      await compare("swaps", c, `target ${target}`, async () =>
        swapsShape(await getSwapSuggestions(db, { context, targetCardId: target, limit: SWAP_LIMIT })),
      );
      // The swap route's cached path: one pool per target and commanders, ranked per deck.
      await compare("swaps shared pool", c, `target ${target}`, async () => {
        const shared = await loadSwapPool(db, {
          targetCardId: target,
          commanderIds: [...c.commanders].sort((a, b) => a - b),
          includeGameChangers: context.includeGameChangers,
          excludeIds: [],
          ownedIds: null,
          poolSize: SHARED_SWAP_POOL,
        });
        return shared ? swapsShape(rankSwaps(shared, { context, limit: SWAP_LIMIT })) : null;
      });
      await compare("swaps owned-first", c, `target ${target}`, async () => {
        const shared = await loadSwapPool(db, {
          targetCardId: target,
          commanderIds: [...c.commanders].sort((a, b) => a - b),
          includeGameChangers: context.includeGameChangers,
          excludeIds: [],
          ownedIds: null,
          poolSize: SHARED_SWAP_POOL,
        });
        return shared ? swapsShape(rankSwaps(shared, { context: owned("first"), limit: SWAP_LIMIT })) : null;
      });
      await compare("swaps owned-only", { ...c, gated: false }, `target ${target}`, async () =>
        swapsShape(await getSwapSuggestions(db, { context: owned("only"), targetCardId: target, limit: SWAP_LIMIT })),
      );
    }
    await compare("rater", c, "", async () => (await dealRaterCards(db, { commanderIds: c.commanders })).cards.map((card) => card.id));
    // The commander read is shared by both paths, so it is checked against the two reads it replaced.
    const [now, before] = await Promise.all([loadCommanderCorpus(db, c.commanders), legacyCommanderCorpus(db, c.commanders)]);
    const corpusTally = tally.get("commander corpus") ?? { compared: 0, identical: 0, gated: 0, gatedDifferent: 0 };
    corpusTally.compared++;
    corpusTally.gated++;
    if (JSON.stringify(now) === JSON.stringify(before)) corpusTally.identical++;
    else {
      corpusTally.gatedDifferent++;
      const found = firstDifference(before, now);
      differences.push({ kind: "commander corpus", case: c.name, detail: "", at: found?.at ?? "$", old: show(found?.old), served: show(found?.served) });
    }
    tally.set("commander corpus", corpusTally);
    process.stdout.write(`  ${n + 1}/${cases.length} ${c.name}\n`);
  }

  // Pages: every sampled commander with decks of its own, and a card from each deck.
  for (const k of keys.filter((k) => cases.some((c) => c.name.includes(k.slug)))) {
    const c: Case = { name: `commander page ${k.slug}`, gated: true, commanders: [], cards: [] };
    await compare("commander page", c, k.slug, async () => {
      const page = await loadCommanderPage(db, k.slug);
      return page && { groups: addsShape(page.top).groups, roles: page.roleProfile };
    });
  }
  const cardIds = [...new Set(cases.flatMap((c) => pick(c.cards, 1)))];
  const { data: slugs, error } = await db.from("cards").select("id, slug").in("id", cardIds);
  if (error) throw new Error(`Loading card slugs failed: ${error.message}`);
  for (const s of slugs) {
    await compare("card page", { name: `card page ${s.slug}`, gated: true, commanders: [], cards: [] }, s.slug, async () => {
      const page = await loadCardPage(db, s.slug);
      return page && swapsShape(page.alternatives);
    });
  }

  const kinds = Object.fromEntries(tally);
  const report = {
    finishedAt: new Date().toISOString(),
    seed: Number(arg("--seed") ?? DEFAULT_SEED),
    decks: cases.length,
    kinds,
    timing: Object.fromEntries(
      [...timings].map(([kind, t]) => [kind, { oldP50: quantile(t.old, P50), oldP95: quantile(t.old, P95), servedP50: quantile(t.served, P50), servedP95: quantile(t.served, P95) }]),
    ),
    rounds: Object.fromEntries(
      [...rounds].map(([kind, r]) => [
        kind,
        {
          oldWavesP50: quantile(r.oldWaves, P50),
          servedWavesP50: quantile(r.servedWaves, P50),
          servedWavesMax: Math.max(...r.servedWaves),
          oldRequestsP50: quantile(r.oldRequests, P50),
          servedRequestsP50: quantile(r.servedRequests, P50),
        },
      ]),
    ),
    differences,
  };
  const dir = path.join(process.env.MTG_DATA_DIR ?? tmpdir(), "reports");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `serving-parity-${report.finishedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

  console.log("\nkind                   compared  identical  gated-different");
  for (const [kind, t] of tally) {
    console.log(`${kind.padEnd(22)} ${String(t.compared).padStart(8)}  ${String(t.identical).padStart(9)}  ${String(t.gatedDifferent).padStart(15)}`);
  }
  if (timing) {
    console.log("\nkind                   old p50/p95 ms   served p50/p95 ms");
    for (const [kind, t] of Object.entries(report.timing)) {
      console.log(`${kind.padEnd(22)} ${`${t.oldP50}/${t.oldP95}`.padStart(15)}   ${`${t.servedP50}/${t.servedP95}`.padStart(17)}`);
    }
  }
  console.log("\nkind                   waves old/served (p50)   requests old/served (p50)   served waves max");
  for (const [kind, r] of Object.entries(report.rounds)) {
    console.log(
      `${kind.padEnd(22)} ${`${r.oldWavesP50}/${r.servedWavesP50}`.padStart(24)}   ${`${r.oldRequestsP50}/${r.servedRequestsP50}`.padStart(25)}   ${String(r.servedWavesMax).padStart(16)}`,
    );
  }
  const failed = [...tally.values()].reduce((sum, t) => sum + t.gatedDifferent, 0);
  // A cached setting expiring mid-run adds a wave now and then, so the gate is on the typical call.
  const slow = Object.entries(report.rounds).filter(([kind, r]) => ONE_WAVE_KINDS.has(kind) && r.servedWavesP50 > 1).map(([kind]) => kind);
  console.log(`\n${failed === 0 ? "Parity: every gated list matches." : `Parity: ${failed} gated lists differ.`} Report: ${file}`);
  if (slow.length > 0) console.log(`More than one wave on the serving path: ${slow.join(", ")}`);
  process.exitCode = failed === 0 && slow.length === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
