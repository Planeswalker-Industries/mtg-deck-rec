/**
 * Checks that the search index is only ever an optimisation: with no search API, a slow one or a broken one, every
 * read path still answers, out of Postgres. Nothing here touches a database or a search service — both are faked, so
 * this runs in CI where neither exists.
 *
 * Usage: yarn workspace @mtg/web tsx scripts/search-index-check.ts
 */
import { SearchClient } from "@mtg/core/search";
import { searchCards } from "../src/lib/server/card-search";
import { fetchCardsById } from "../src/lib/server/cards";
import { clearSearchIndexCachesForTesting, fromIndex, setSearchIndexForTesting } from "../src/lib/server/search-index";
import type { PublicClient } from "../src/lib/server/supabase";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

const CARD_ROW = {
  id: 1,
  oracle_id: "b1544f21-7e98-461b-aed5-e748b0168c52",
  name: "Swords to Plowshares",
  slug: "swords-to-plowshares",
  mana_value: 1,
  type_line: "Instant",
  color_identity: 1,
  images: null,
  game_changer: false,
  released_at: "1993-08-05",
  reference_price_usd: 1.43,
  reference_price_finish: "nonfoil",
  prices_as_of: "2026-09-15T21:17:43.306Z",
  legal_commander: "legal",
  can_be_commander: false,
  partner_kind: null,
  partner_qualifier: null,
  copy_limit: null,
  is_basic_land: false,
  artist: "Terese Nielsen",
  keywords: [],
};

/** A Supabase client that answers the shapes these paths ask for, and counts the queries it was asked. */
function fakeDb() {
  let queries = 0;
  // PostgREST builders are thenable chains: every filter returns the builder, and awaiting it runs the query.
  const table: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown[]; error: null }) => void) => resolve({ data: [CARD_ROW], error: null }),
  };
  for (const method of ["select", "in", "eq", "is", "limit", "order", "maybeSingle"]) table[method] = () => table;

  return {
    get queries() {
      return queries;
    },
    client: {
      from: () => {
        queries++;
        return table;
      },
      rpc: (name: string) => {
        queries++;
        const idOnly = name === "search_cards" || name === "search_cards_filtered";
        return Promise.resolve({ data: idOnly ? [{ card_id: 1 }] : null, error: null });
      },
    } as unknown as PublicClient,
  };
}

/** A search client whose every call fails the way a down or overloaded service would. */
function brokenIndex(): SearchClient {
  const fail = () => Promise.reject(new Error("connect ECONNREFUSED"));
  return {
    health: fail,
    cardsByID: fail,
    searchCards: fail,
    pageExists: fail,
    allTags: fail,
    commanderCardRates: fail,
    commanderCardsTop: fail,
  } as unknown as SearchClient;
}

async function main() {
  // 1. Unconfigured. The normal state in CI and in a fresh checkout.
  setSearchIndexForTesting(null);
  clearSearchIndexCachesForTesting();
  {
    const db = fakeDb();
    const cards = await fetchCardsById(db.client, [1]);
    check("with no index, cards come from the database", cards.get(1)?.name === "Swords to Plowshares", `${db.queries} queries`);
    check("with no index, nothing is even attempted", (await fromIndex("probe", async () => "reached")) === null, "fromIndex returned null");
  }
  {
    const db = fakeDb();
    const { cards: results, source } = await searchCards(db.client, { q: "swords" });
    check(
      "with no index, search comes from the database",
      results[0]?.name === "Swords to Plowshares" && source === "postgres-unconfigured",
      `${results.length} result(s) from ${source}`,
    );
  }

  // 2. Configured but broken. The failure mode that matters: the site must not notice.
  setSearchIndexForTesting(brokenIndex());
  clearSearchIndexCachesForTesting();
  {
    const db = fakeDb();
    const cards = await fetchCardsById(db.client, [1]);
    check("a broken index falls back to the database for cards", cards.get(1)?.name === "Swords to Plowshares", `${db.queries} queries`);
  }
  {
    const db = fakeDb();
    const { cards: results, source } = await searchCards(db.client, { q: "swords" });
    // The reported source separates a broken index from an absent one; they look the same to the visitor and need
    // different fixes.
    check(
      "a broken index falls back to the database for search",
      results[0]?.name === "Swords to Plowshares" && source === "postgres-index-failed",
      `${results.length} result(s) from ${source}`,
    );
  }
  {
    // The deckbuilder's search is the newest path onto the index, and the one that used to be Postgres-only. It has
    // to fall back like every other read: same results, and a source that says which side answered.
    const db = fakeDb();
    const { cards: results, source } = await searchCards(db.client, { q: "swords", colorIdentity: "W", cardType: "instant" });
    check(
      "a broken index falls back to the database for the deckbuilder's filtered search",
      results[0]?.name === "Swords to Plowshares" && source === "postgres-filtered",
      `${results.length} result(s) from ${source}`,
    );
  }
  {
    const boxed = await fromIndex("probe", (index) => index.health());
    check("a broken index reports 'no answer', not a bad answer", boxed === null, `fromIndex returned ${JSON.stringify(boxed)}`);
  }

  // 3. A working index answers, and the answer is distinguishable from a fallback.
  setSearchIndexForTesting({ cardsByID: async () => [] } as unknown as SearchClient);
  {
    const db = fakeDb();
    const cards = await fetchCardsById(db.client, [1]);
    check(
      "an index that answers is believed, and the database is not asked",
      cards.size === 0 && db.queries <= 1,
      `${cards.size} cards, ${db.queries} quer${db.queries === 1 ? "y" : "ies"} (the price check only)`,
    );
  }

  setSearchIndexForTesting(null);
  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

void main();
