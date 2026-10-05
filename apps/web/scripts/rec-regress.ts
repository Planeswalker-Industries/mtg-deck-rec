/**
 * Recommendation regression check. Runs decklists through the real parse, cut, add and swap code against the database
 * in .env.local and checks each fixture's expectations. Fixtures (see FixtureFile) live in the private
 * public.regression_fixtures table, never in the repo: they hold real decklists.
 *
 * Usage (from apps/web, with --env-file=.env.local, which must set SUPABASE_SECRET_KEY):
 *   yarn workspace @mtg/web regress                    run every stored fixture
 *   yarn workspace @mtg/web regress --import <dir>     store or replace the fixtures in <dir>/*.json, by name
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defaultIncludeGameChangers } from "@mtg/core/commander";
import type { Bracket, CardSummary, CutReason, RecContext } from "@mtg/core/contract";
import type { Json } from "../src/lib/server/database.types";
import { resolveDecklist } from "../src/lib/server/deck";
import { getAddSuggestions, getCutSuggestions, getSwapSuggestions } from "../src/lib/server/recs";
import { createPublicClient } from "../src/lib/server/supabase";
import { createAdminClient } from "../src/lib/server/supabase-admin";

interface TopExpectation {
  cards: string[];
  top: number;
}

interface FixtureFile {
  name: string;
  decklist?: string;
  /** Path to a decklist file, relative to the fixture file. Read into `decklist` when the fixture is imported. */
  deckFile?: string;
  bracket?: Bracket;
  includeGameChangers?: boolean;
  expect: {
    commanders?: string[];
    /** Most unresolved lines allowed (default 0). */
    unresolved?: number;
    cut?: { include?: string[]; exclude?: string[]; notFlagged?: { card: string; reason: CutReason }[] };
    /** `top` counts within the card's category group. */
    add?: { includeTop?: { card: string; top: number }[]; exclude?: string[] };
    swaps?: { target: string; includeTop?: TopExpectation; excludeTop?: TopExpectation }[];
  };
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const sameCard = (card: CardSummary, name: string) => card.name === name || card.name.split(" // ")[0] === name;
/** 1-based rank, or 0 when absent. */
const rankOf = (cards: readonly CardSummary[], name: string) => cards.findIndex((c) => sameCard(c, name)) + 1;
const describeRank = (rank: number) => (rank > 0 ? `#${rank}` : "not suggested");

async function runFixture(fixture: FixtureFile): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const text = fixture.decklist ?? "";
  const db = createPublicClient();

  const parsed = await resolveDecklist(db, text);
  const unresolved = parsed.lines.filter((l) => l.resolution.status !== "resolved");
  check(
    "unresolved lines",
    unresolved.length <= (fixture.expect.unresolved ?? 0),
    unresolved.length === 0 ? "none" : unresolved.map((l) => l.line.name).join(", "),
  );
  const analysis = parsed.analysis;
  if (!analysis) {
    check("analysis", false, "the deck wasn't analyzed");
    return checks;
  }

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
  const context: RecContext = {
    deck: analysis.deck,
    bracket,
    bracketSource: fixture.bracket ? "user" : "inferred",
    includeGameChangers: fixture.includeGameChangers ?? defaultIncludeGameChangers(bracket),
    ownership: null,
  };
  const { cut, add, swaps } = fixture.expect;

  if (cut) {
    const result = await getCutSuggestions(db, { context, limit: 40 });
    const cards = result.suggestions.map((s) => s.card);
    for (const name of cut.include ?? []) check(`cut suggests ${name}`, rankOf(cards, name) > 0, describeRank(rankOf(cards, name)));
    for (const name of cut.exclude ?? []) check(`cut leaves ${name} alone`, rankOf(cards, name) === 0, describeRank(rankOf(cards, name)));
    for (const { card, reason } of cut.notFlagged ?? []) {
      const found = result.suggestions.find((s) => sameCard(s.card, card));
      check(`cut doesn't flag ${card} as ${reason}`, !found?.reasons.includes(reason), found ? found.reasons.join("+") : "not suggested");
    }
  }

  if (add) {
    const result = await getAddSuggestions(db, { context, limitPerCategory: 30 });
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
    const result = await getSwapSuggestions(db, { context, targetCardId: line.resolution.card.id, limit: 20 });
    const cards = result.suggestions.map((s) => s.card);
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
  return checks;
}

/** Stores every fixture file in `dir`, replacing a stored fixture of the same name; a deckFile is read in. */
async function importFixtures(dir: string): Promise<void> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`No fixture files in ${dir}`);
  const rows = files.map((f) => {
    const file = path.join(dir, f);
    const fixture = JSON.parse(readFileSync(file, "utf8")) as FixtureFile;
    const { deckFile, ...rest } = fixture;
    const decklist = fixture.decklist ?? (deckFile ? readFileSync(path.resolve(dir, deckFile), "utf8") : undefined);
    return { name: fixture.name, fixture: { ...rest, decklist } as unknown as Json, updated_at: new Date().toISOString() };
  });
  const { error } = await createAdminClient().from("regression_fixtures").upsert(rows, { onConflict: "name" });
  if (error) throw new Error(`storing fixtures: ${error.message}`);
  console.log(`Stored ${rows.length} fixtures: ${rows.map((r) => r.name).join(", ")}`);
}

async function main(): Promise<void> {
  const importIndex = process.argv.indexOf("--import");
  if (importIndex !== -1) {
    const dir = process.argv[importIndex + 1];
    if (!dir) throw new Error("--import needs a directory of fixture files");
    return importFixtures(path.resolve(dir));
  }

  const { data, error } = await createAdminClient().from("regression_fixtures").select("fixture").order("name");
  if (error) throw new Error(`reading fixtures: ${error.message}`);
  const fixtures = data.map((row) => row.fixture as unknown as FixtureFile);
  if (fixtures.length === 0) throw new Error("No fixtures stored yet. Load them with: regress --import <dir>");

  let failed = 0;
  for (const fixture of fixtures) {
    const checks = await runFixture(fixture).catch((err: unknown): Check[] => [
      { name: "run", ok: false, detail: err instanceof Error ? err.message : String(err) },
    ]);
    console.log(`\n${fixture.name}`);
    for (const c of checks) {
      console.log(`  ${c.ok ? "pass" : "FAIL"}  ${c.name}: ${c.detail}`);
      if (!c.ok) failed++;
    }
  }
  console.log(`\n${failed === 0 ? "All checks passed" : `${failed} check${failed === 1 ? "" : "s"} failed`} (${fixtures.length} fixtures)`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
