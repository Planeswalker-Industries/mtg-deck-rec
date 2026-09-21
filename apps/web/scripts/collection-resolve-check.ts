/**
 * Runs pasted collection text through the real parser and matching against the local database, and checks what each row
 * resolves to.
 *
 * Usage: yarn workspace @mtg/web tsx --env-file=.env.local scripts/collection-resolve-check.ts
 */
import type { CollectionRowInput } from "@mtg/core/contract";
import { parseCollectionText } from "@mtg/core/parse";
import { resolveCollectionRows } from "../src/lib/server/collections";
import { createPublicClient } from "../src/lib/server/supabase";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

async function main() {
  const db = createPublicClient();
  const text = [
    "4 Sol Ring (C21) 263 *F*",
    "1x Lightning Bolt",
    "2 Swords to Plowshares (sta) 10",
    "1 Definitely Not A Card",
  ].join("\n");
  const rows: CollectionRowInput[] = [
    ...parseCollectionText(text),
    { rowNo: 50, quantity: 1 },
    { rowNo: 51, quantity: 3, name: "Counterspell", lang: "JA", condition: "LP" },
  ];

  const result = await resolveCollectionRows(db, rows);
  const byRow = new Map(result.resolved.map((r) => [r.rowNo, r]));
  const unresolved = new Map(result.unresolved.map((r) => [r.rowNo, r]));
  console.log(`epoch ${result.catalogEpoch}; ${result.resolved.length} resolved, ${result.unresolved.length} unresolved`);

  const solRing = byRow.get(1);
  check("set + number with foil", solRing?.via === "set_cn" && solRing.finish === "foil" && solRing.quantity === 4 && solRing.printingId !== null, JSON.stringify(solRing));
  const bolt = byRow.get(2);
  check("name only keeps no printing", bolt?.via === "name_only" && bolt.printingId === null && bolt.finish === "nonfoil" && bolt.lang === "en", JSON.stringify(bolt));
  const swords = byRow.get(3);
  check("lower-case set code", swords?.via === "set_cn" && swords.printingId !== null, JSON.stringify(swords));
  check("unknown card is NOT_FOUND", unresolved.get(4)?.reason === "NOT_FOUND", JSON.stringify(unresolved.get(4)));
  check("row with nothing to match is INVALID", unresolved.get(50)?.reason === "INVALID", JSON.stringify(unresolved.get(50)));
  const counterspell = byRow.get(51);
  check("language and condition carried through", counterspell?.lang === "ja" && counterspell.condition === "LP" && counterspell.quantity === 3, JSON.stringify(counterspell));
  check("epoch present", /^\d+$/.test(result.catalogEpoch) && result.catalogEpoch !== "0", result.catalogEpoch);

  // PostgREST returns at most `[api] max_rows` rows (1000) and drops the overflow silently, so a batch that
  // matches more than that used to lose the remainder and report it NOT_FOUND. Matching now chunks internally.
  const many: CollectionRowInput[] = Array.from({ length: 1_200 }, (_, i) => ({
    rowNo: 1_000 + i,
    quantity: 1,
    name: "Sol Ring",
    setCode: "C21",
    collectorNumber: "263",
  }));
  const bulk = await resolveCollectionRows(db, many);
  check(
    "more rows than the PostgREST row cap all match",
    bulk.resolved.length === many.length && bulk.unresolved.length === 0,
    `${bulk.resolved.length} resolved, ${bulk.unresolved.length} unresolved`,
  );

  console.log(failures.length ? `FAILURES: ${failures.join(", ")}` : "all collection resolve checks passed");
  if (failures.length) process.exitCode = 1;
}

void main();
