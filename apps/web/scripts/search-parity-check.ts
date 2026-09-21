/**
 * Compares what the search index answers with what Postgres answers, against the real local catalog. This is the
 * check that says the index is telling the truth; `search-index-check.ts` is the one that says the app survives
 * without it.
 *
 * Needs the local Supabase stack with a synced catalog, and a built index behind a running search API:
 *   docker compose -f ../../docker-compose.search.yml up -d
 *   yarn workspace @mtg/worker cli sync:typesense --rebuild
 *   yarn workspace @mtg/web tsx --env-file=.env.local scripts/search-parity-check.ts
 */
import { searchCards } from "../src/lib/server/card-search";
import { fetchCardTags } from "../src/lib/server/card-tags";
import { fetchCardsById } from "../src/lib/server/cards";
import { fromIndex, getSearchIndex, setSearchIndexForTesting } from "../src/lib/server/search-index";
import { createPublicClient } from "../src/lib/server/supabase";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

/** Runs something with the index switched off, so the same code path reads Postgres. */
async function withoutIndex<T>(run: () => Promise<T>): Promise<T> {
  const index = getSearchIndex();
  setSearchIndexForTesting(null);
  try {
    return await run();
  } finally {
    setSearchIndexForTesting(index);
  }
}

/** The tiers public.search_cards ranks by: a name start, a name from inside, a typo, and a back face. */
const QUERIES = ["sol ring", "swords", "plowshares", "lightening bolt", "cultivat", "rhystic", "smothering", "counterspel", "esper sent", "doubling"];

async function main() {
  const db = createPublicClient();
  if (!getSearchIndex()) {
    console.log("SEARCH_API_URL / SEARCH_API_TOKEN are not set, so there is nothing to compare against.");
    process.exitCode = 1;
    return;
  }

  // Every read path falls back to Postgres when the index does not answer, which means a check like this can pass
  // for the wrong reason — comparing Postgres with itself. Prove the index is actually answering first, with a read
  // that needs the token: /v1/health is unauthenticated and answers "ok" to a caller with no credentials at all.
  const reachable = await fromIndex("probe", async (index) => (await index.searchCards({ q: "sol", limit: 1 })).length > 0);
  if (reachable?.value !== true) {
    console.log("FAIL  the index is not answering, so there is nothing to compare. Check SEARCH_API_URL and SEARCH_API_TOKEN.");
    process.exitCode = 1;
    return;
  }
  check("the index is answering", true, "so a pass below means the two sources agree, not that both fell back");

  // 1. Search.
  //
  //    The index must not *invent* a result: its top hit has to be a card `public.search_cards` also returned. It is
  //    deliberately not asserted to be the *same* top hit. Both rank a name start above a name it is merely inside,
  //    but below that the SQL falls through similarity to `c.name` — alphabetical, in practice — where the index
  //    breaks the tie on how played the card is. Measured on the local catalog, every case where the two disagree is
  //    one where that is plainly better: "rhystic" gives Rhystic Study rather than Rhystic Cave, "doubling" gives
  //    Doubling Season rather than Doubling Chant, and a typo'd "lightening bolt" gives Lightning Bolt rather than
  //    the double-faced card whose back is Lightning Bolt.
  for (const q of QUERIES) {
    const [indexed, postgres] = [await searchCards(db, { q, limit: 8 }), await withoutIndex(() => searchCards(db, { q, limit: 8 }))];
    const top = indexed[0];
    const known = top !== undefined && postgres.some((p) => p.id === top.id);
    const overlap = indexed.filter((c) => postgres.some((p) => p.id === c.id)).length;
    const order = top?.name === postgres[0]?.name ? "same top hit" : `top hit ${top?.name ?? "(none)"} where the database gives ${postgres[0]?.name ?? "(none)"}`;
    check(`search "${q}"`, known && overlap > 0, `${order}, ${overlap}/${indexed.length} shared`);
  }

  // The commander picker filters the same pool down to cards that can actually lead a deck.
  {
    const commanders = await searchCards(db, { q: "atraxa", commanderEligible: true, limit: 5 });
    const fromDb = await withoutIndex(() => searchCards(db, { q: "atraxa", commanderEligible: true, limit: 5 }));
    const sameSet = commanders.length === fromDb.length && commanders.every((c) => fromDb.some((d) => d.id === c.id));
    check("commander-only search returns the same cards", sameSet, `${commanders.length} commander(s): ${commanders.map((c) => c.name).join(", ")}`);
  }

  // 2. Card rows: a document must rebuild a row byte for byte, or something downstream is reading a different card.
  const { data: sample, error } = await db.from("cards").select("id").is("deleted_at", null).limit(500);
  if (error) throw new Error(error.message);
  const ids = sample.map((r) => r.id);
  const [fromIndexRows, fromDb] = [await fetchCardsById(db, ids), await withoutIndex(() => fetchCardsById(db, ids))];
  const mismatched = ids.filter((id) => JSON.stringify(fromIndexRows.get(id)) !== JSON.stringify(fromDb.get(id)));
  check("card rows are identical", mismatched.length === 0, `${ids.length - mismatched.length}/${ids.length} identical${mismatched.length ? `, first difference on card ${mismatched[0]}` : ""}`);

  // 3. Functional tags, including the two-step walk up the hierarchy and the depth each tag was reached at.
  const tagIds = ids.slice(0, 100);
  const [tagsIndexed, tagsDb] = [await fetchCardTags(db, tagIds), await withoutIndex(() => fetchCardTags(db, tagIds))];
  const key = (rows: Awaited<ReturnType<typeof fetchCardTags>>) =>
    new Map(rows.map((r) => [r.cardId, [...r.tags].map((t) => `${t.id}@${t.depth}`).sort().join(",")]));
  const [a, b] = [key(tagsIndexed), key(tagsDb)];
  const tagMismatch = [...b].filter(([id, value]) => a.get(id) !== value);
  check("functional tags agree", tagMismatch.length === 0 && a.size === b.size, `${b.size} cards with tags${tagMismatch.length ? `, first difference on card ${tagMismatch[0]?.[0]}` : ""}`);

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

void main();
