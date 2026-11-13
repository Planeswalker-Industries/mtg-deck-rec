/**
 * Recommendation regression check. Runs decklists through the real parse, cut, add, swap, build and Fix code against
 * the local database and checks each fixture's expectations. Fixtures are JSON files (see FixtureFile) kept outside the
 * repo, since they hold real decklists and collections; where they live is the machine's business.
 *
 * Usage: yarn workspace @mtg/web regress [fixtureDir]   (default: $MTG_DATA_DIR/regression)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { sessionCopies, type CollectionCopies } from "@mtg/core/collection";
import { defaultIncludeGameChangers } from "@mtg/core/commander";
import type { Bracket, CardId, CardSummary, CutReason, DeckAnalysis, DeckInput, OwnershipInput, RecContext, SwapMatch } from "@mtg/core/contract";
import {
  applyCard,
  buildTally,
  comboPiecesToKeep,
  fixLines,
  gradeDeck,
  planFixes,
  toTallyCard,
  type BracketInput,
  type DeckStatsReport,
  type FixInput,
  type TallyEntry,
} from "@mtg/core/journey";
import { resolveCollectionRows } from "../src/lib/server/collections";
import { analyzeDeckById, resolveDecklist } from "../src/lib/server/deck";
import { getAddSuggestions, getBuild, getCutSuggestions, getFix, getSwapSuggestions } from "../src/lib/server/recs";
import { createPublicClient, type PublicClient } from "../src/lib/server/supabase";

interface TopExpectation {
  cards: string[];
  top: number;
}

interface FixtureFile {
  name: string;
  decklist?: string;
  /** Path to a decklist file, relative to the fixture file. */
  deckFile?: string;
  bracket?: Bracket;
  includeGameChangers?: boolean;
  /** A collection as "N Name" lines, relative to the fixture file. With one, the run is Owned only. */
  collectionFile?: string;
  /** Build the deck from the collection first: the decklist then names the commanders alone. */
  build?: boolean;
  /** Deck stats lines opened to unowned cards (`RecContext.buyFor`), by key. */
  buyFor?: string[];
  expect: {
    commanders?: string[];
    /** Most unresolved lines allowed (default 0). */
    unresolved?: number;
    cut?: { include?: string[]; exclude?: string[]; notFlagged?: { card: string; reason: CutReason }[] };
    /** `top` counts within the card's category group. */
    add?: { includeTop?: { card: string; top: number }[]; exclude?: string[] };
    /**
     * `minSuggestions`: the card gets at least this many replacements (T088: no dead end). `match`: every replacement
     * comes from one of these rungs of the swap ladder.
     */
    swaps?: { target: string; includeTop?: TopExpectation; excludeTop?: TopExpectation; minSuggestions?: number; match?: SwapMatch[] }[];
    /**
     * Fix's whole plan ("Fix the rest for me") on the deck. Always checked: every line still off after the plan has a
     * reason (no move is left for it). `inLine`: Deck stats lines, by label, the plan must leave in line. `noMove`: the
     * plan is empty. `gapsAsked`: every line Fix can't bring in is one the build reported (`collectionGaps`), so the
     * build page asks about it.
     */
    fix?: { inLine?: string[]; noMove?: boolean; gapsAsked?: boolean };
  };
}

/** How many times Fix and Add are timed, to compare them (the first run of each pays for the cold caches). */
const TIMED_RUNS = 5;
/** Scores are rounded to three places: closer than this is the same score. */
const SCORE_EPSILON = 0.0005;
const BYTES_PER_KB = 1024;
/** A response's size as JSON in whole kilobytes, gzipped as the host sends it: what a phone downloads. */
const jsonKb = (value: unknown) => Math.round(gzipSync(JSON.stringify(value)).byteLength / BYTES_PER_KB);

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Lines printed under the check: a Fix plan's moves. */
  notes?: string[];
}

/** The fixture folder: the argument, else `regression` under the machine's MTG_DATA_DIR. */
function fixtureDirectory(): string {
  const given = process.argv[2] ?? (process.env.MTG_DATA_DIR ? path.join(process.env.MTG_DATA_DIR, "regression") : undefined);
  if (!given) throw new Error("No fixture folder: pass one (regress <dir>) or set MTG_DATA_DIR to the folder that holds regression/");
  return path.resolve(given);
}

const sameCard = (card: CardSummary, name: string) => card.name === name || card.name.split(" // ")[0] === name;
/** 1-based rank, or 0 when absent. */
const rankOf = (cards: readonly CardSummary[], name: string) => cards.findIndex((c) => sameCard(c, name)) + 1;
const describeRank = (rank: number) => (rank > 0 ? `#${rank}` : "not suggested");

/** A collection file ("N Name" a line) as the request and the server read it, resolved by the app's own import. */
async function loadCollection(db: PublicClient, file: string): Promise<{ ownership: OwnershipInput; copies: CollectionCopies; unresolved: string[] }> {
  const rows = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((line, rowNo) => {
      const match = /^(\d+)\s+(.+)$/.exec(line.trim());
      return match ? [{ rowNo, name: match[2] ?? "", quantity: Number(match[1]) }] : [];
    });
  const { resolved, unresolved } = await resolveCollectionRows(db, rows);
  const owned = new Map<number, number>();
  for (const row of resolved) owned.set(row.cardId, (owned.get(row.cardId) ?? 0) + row.quantity);
  const ownership: OwnershipInput = {
    kind: "session",
    catalogEpoch: "regress",
    ownedCardIds: [...owned.keys()] as CardId[],
    quantities: [...owned.values()],
  };
  const names = new Map(rows.map((row) => [row.rowNo, row.name]));
  return {
    ownership,
    copies: sessionCopies(ownership) ?? { owned, builtDecks: [] },
    unresolved: unresolved.map((row) => names.get(row.rowNo) ?? `row ${row.rowNo}`),
  };
}

/** The median of a few timed runs, in milliseconds. */
async function medianMs(run: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const from = performance.now();
    await run();
    times.push(performance.now() - from);
  }
  return Math.round(times.sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0);
}

/** A Deck stats line's label by its key, for the lines Fix names. */
function lineLabels(report: DeckStatsReport): Map<string, string> {
  return new Map([...report.stats.map((s) => [s.key, s.label] as const), ["curve", "Curve"], ["bracket", "Bracket"], ["legal", "Legal cards"]]);
}

async function runFixture(file: string, fixture: FixtureFile): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const text = fixture.decklist ?? (fixture.deckFile ? readFileSync(path.resolve(path.dirname(file), fixture.deckFile), "utf8") : "");
  const db = createPublicClient();
  const owned = fixture.collectionFile ? await loadCollection(db, path.resolve(path.dirname(file), fixture.collectionFile)) : null;
  const collection = owned?.copies ?? null;
  if (owned) check("collection resolves", true, `${owned.copies.owned.size} cards; ${owned.unresolved.length} unresolved${owned.unresolved.length > 0 ? `: ${owned.unresolved.slice(0, 8).join(", ")}` : ""}`);

  const parsed = await resolveDecklist(db, text);
  const unresolved = parsed.lines.filter((l) => l.resolution.status !== "resolved");
  check(
    "unresolved lines",
    unresolved.length <= (fixture.expect.unresolved ?? 0),
    unresolved.length === 0 ? "none" : unresolved.map((l) => l.line.name).join(", "),
  );
  if (!parsed.analysis) {
    check("analysis", false, "the deck wasn't analyzed");
    return checks;
  }
  let analysis: DeckAnalysis = parsed.analysis;

  const commanderNames = analysis.commanderKey.commanders.map((c) => c.name);
  const expectedCommanders = fixture.expect.commanders;
  if (expectedCommanders) {
    check(
      "commanders",
      expectedCommanders.length === commanderNames.length && expectedCommanders.every((n) => commanderNames.includes(n)),
      commanderNames.join(" + ") || "none",
    );
  }

  const bracket = fixture.bracket ?? analysis.estimatedBracket;
  let context: RecContext = {
    deck: analysis.deck,
    bracket,
    bracketSource: fixture.bracket ? "user" : "inferred",
    includeGameChangers: fixture.includeGameChangers ?? defaultIncludeGameChangers(bracket),
    ownership: owned?.ownership ?? null,
    ...(owned ? { ownershipMode: "only" as const } : {}),
    ...(fixture.buyFor ? { buyFor: fixture.buyFor } : {}),
  };
  const { cut, add, swaps, fix } = fixture.expect;

  // A build fixture goes on with the deck the builder makes from the collection.
  let collectionGaps: string[] = [];
  if (fixture.build) {
    const built = await getBuild(db, { context: { ...context, deck: { commanders: analysis.deck.commanders, cards: [] } }, collection });
    const deck: DeckInput = {
      commanders: analysis.deck.commanders,
      cards: [
        ...built.groups.flatMap((g) => g.cards.map((c) => ({ cardId: c.card.id, quantity: 1, section: "main" as const }))),
        ...built.basics.map((b) => ({ cardId: b.card.id, quantity: b.quantity, section: "main" as const })),
      ],
    };
    analysis = await analyzeDeckById(db, deck);
    context = { ...context, deck };
    collectionGaps = built.feasibility.collectionGaps;
    const f = built.feasibility;
    check("build", true, `${f.filled} filled, ${f.filledByValue} bought, ${f.open} open; gaps: ${collectionGaps.join(", ") || "none"}`);
  }

  if (cut) {
    const result = await getCutSuggestions(db, { context, collection, limit: 40 });
    const cards = result.suggestions.map((s) => s.card);
    for (const name of cut.include ?? []) check(`cut suggests ${name}`, rankOf(cards, name) > 0, describeRank(rankOf(cards, name)));
    for (const name of cut.exclude ?? []) check(`cut leaves ${name} alone`, rankOf(cards, name) === 0, describeRank(rankOf(cards, name)));
    for (const { card, reason } of cut.notFlagged ?? []) {
      const found = result.suggestions.find((s) => sameCard(s.card, card));
      check(`cut doesn't flag ${card} as ${reason}`, !found?.reasons.includes(reason), found ? found.reasons.join("+") : "not suggested");
    }
  }

  if (add) {
    const result = await getAddSuggestions(db, { context, collection, limitPerCategory: 30 });
    for (const { card, top } of add.includeTop ?? []) {
      const group = result.groups.find((g) => g.suggestions.some((s) => sameCard(s.card, card)));
      const rank = group ? rankOf(group.suggestions.map((s) => s.card), card) : 0;
      check(`add has ${card} in its group's top ${top}`, rank > 0 && rank <= top, rank > 0 ? `#${rank} in ${group?.category}` : "not suggested");
    }
    const all = result.groups.flatMap((g) => g.suggestions.map((s) => s.card));
    for (const name of add.exclude ?? []) check(`add leaves out ${name}`, rankOf(all, name) === 0, rankOf(all, name) > 0 ? "suggested" : "not suggested");
  }

  for (const swap of swaps ?? []) {
    const line = parsed.lines.find((l) => l.resolution.status === "resolved" && sameCard(l.resolution.card, swap.target));
    if (line?.resolution.status !== "resolved") {
      check(`swap target ${swap.target}`, false, "not in the deck");
      continue;
    }
    const result = await getSwapSuggestions(db, { context, collection, targetCardId: line.resolution.card.id, limit: 20 });
    const cards = result.suggestions.map((s) => s.card);
    if (swap.minSuggestions !== undefined) {
      check(`${swap.target} has at least ${swap.minSuggestions} replacements`, result.suggestions.length >= swap.minSuggestions, `${result.suggestions.length}`);
    }
    if (swap.match) {
      const rungs = swap.match;
      const off = result.suggestions.filter((s) => !rungs.includes(s.match)).map((s) => `${s.card.name} (${s.match})`);
      const found = [...new Set(result.suggestions.map((s) => s.match))].join(", ");
      check(`${swap.target} replacements come from ${rungs.join(" or ")}`, off.length === 0, off.length === 0 ? found : off.join(", "));
    }
    const include = swap.includeTop;
    const exclude = swap.excludeTop;
    for (const name of include?.cards ?? []) {
      const rank = rankOf(cards, name);
      check(`${swap.target} → ${name} in top ${include?.top}`, rank > 0 && rank <= (include?.top ?? 20), describeRank(rank));
    }
    for (const name of exclude?.cards ?? []) {
      const rank = rankOf(cards, name);
      check(`${swap.target} → ${name} not in top ${exclude?.top}`, rank === 0 || rank > (exclude?.top ?? 20), describeRank(rank));
    }
  }
  if (fix) {
    const targets = analysis.statTargets;
    if (!targets) {
      check("fix", false, "the deck has no Deck stats targets");
      return checks;
    }
    const result = await getFix(db, { context, collection });
    const deckCards = new Map(result.pool.deck.map((c) => [c.card.id as number, c]));
    const inCards = new Map(result.pool.ins.map((c) => [c.card.id as number, c]));
    const entries: TallyEntry[] = context.deck.cards.flatMap((entry) => {
      const held = entry.section === "main" ? deckCards.get(entry.cardId) : undefined;
      return held ? [{ card: toTallyCard(held.card, held.roles), quantity: entry.quantity }] : [];
    });
    const commanders = analysis.commanderKey.commanders.map((c) => toTallyCard(c, analysis.cardRoles[c.id] ?? []));
    const tally = buildTally(entries, commanders);
    const bracketInput: BracketInput = { chosen: bracket, signals: analysis.bracketSignals, combos: analysis.combos, overBracketAdds: new Map() };
    const input: FixInput = {
      tally,
      targets,
      bracket: bracketInput,
      pool: result.pool,
      skipped: [],
      choices: {},
      addedIds: [],
      protectedIds: comboPiecesToKeep(bracketInput, targets.bracketLimits),
      illegalIds: result.illegalIds,
    };
    // "Fix the rest for me": the whole plan, applied.
    const moves = planFixes(input);
    const fixed = buildTally(entries, commanders);
    for (const move of moves) {
      applyCard(fixed, toTallyCard(move.in, inCards.get(move.in.id)?.roles ?? []), 1);
      applyCard(fixed, fixed.main.get(move.out.id)?.card ?? toTallyCard(move.out, deckCards.get(move.out.id)?.roles ?? []), -1);
    }
    const before = gradeDeck(tally, targets, bracketInput);
    const after = gradeDeck(fixed, targets, bracketInput);
    const labels = lineLabels(after);
    const label = (line: string) => labels.get(line) ?? line;
    const left = fixLines({ ...input, tally: fixed, addedIds: moves.map((m) => m.in.id) });
    const bought = result.pool.ins.filter((c) => c.buyFor !== undefined).length;
    const [fixMs, addMs] = [await medianMs(() => getFix(db, { context, collection })), await medianMs(() => getAddSuggestions(db, { context, collection }))];
    const addKb = jsonKb(await getAddSuggestions(db, { context, collection }));
    checks.push({
      name: "fix plan",
      ok: true,
      detail:
        `${moves.length} moves, Deck stats ${before.okCount}/${before.total} → ${after.okCount}/${after.total}; pool ${result.pool.ins.length} in ` +
        `(${bought} to buy), ${result.pool.deck.length} out; Fix ${fixMs} ms and ${jsonKb(result)} KB gzipped, Add ${addMs} ms and ${addKb} KB (median of ${TIMED_RUNS})`,
      notes: moves.map((move) => `${label(move.line)}: ${move.out.name} → ${move.in.name}`),
    });
    const lineOk = (name: string) => (name === "Curve" ? after.curve.ok : name === "Bracket" ? after.bracket.ok : after.stats.find((s) => s.label === name)?.ok);
    for (const name of fix.inLine ?? []) {
      const stat = after.stats.find((s) => s.label === name);
      check(`fix leaves ${name} in line`, lineOk(name) === true, stat ? `${stat.value} against ${stat.target}` : lineOk(name) === undefined ? "no such line" : "");
    }
    // Fix reads the deck's cards in adds' round, not cuts': the two must still score a card the same.
    const cuts = await getCutSuggestions(db, { context, collection, limit: context.deck.cards.length });
    const differing = cuts.suggestions.filter((s) => Math.abs((deckCards.get(s.card.id)?.score ?? -1) - (1 - s.cutScore)) > SCORE_EPSILON);
    check(
      "fix scores the deck's cards as cuts do",
      differing.length === 0,
      differing.length === 0 ? `${cuts.suggestions.length} cards with a reason to cut` : differing.map((s) => `${s.card.name}: cut ${s.cutScore}, fit ${deckCards.get(s.card.id)?.score}`).join("; "),
    );
    if (fix.noMove) check("fix offers no move", moves.length === 0, `${moves.length} moves`);
    check(
      "every line left off has a reason",
      left.every((l) => l.blocked !== null),
      left.map((l) => `${label(l.line)}: ${l.blocked ?? "a move is left"}`).join("; ") || "none left off",
    );
    if (fix.gapsAsked) {
      const unasked = left.filter((l) => !collectionGaps.includes(l.line));
      check("the build asks about every line Fix can't bring in", unasked.length === 0, unasked.map((l) => label(l.line)).join(", ") || "all asked");
    }
  }
  return checks;
}

async function main(): Promise<void> {
  const fixtureDir = fixtureDirectory();
  const files = readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(fixtureDir, f));
  if (files.length === 0) throw new Error(`No fixtures in ${fixtureDir}`);

  let failed = 0;
  for (const file of files) {
    const fixture = JSON.parse(readFileSync(file, "utf8")) as FixtureFile;
    const checks = await runFixture(file, fixture).catch((err: unknown): Check[] => [
      { name: "run", ok: false, detail: err instanceof Error ? err.message : String(err) },
    ]);
    console.log(`\n${fixture.name}`);
    for (const c of checks) {
      console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.name}: ${c.detail}`);
      for (const note of c.notes ?? []) console.log(`          ${note}`);
      if (!c.ok) failed++;
    }
  }
  console.log(`\n${failed === 0 ? "All checks passed" : `${failed} check${failed === 1 ? "" : "s"} failed`} (${files.length} fixtures)`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
