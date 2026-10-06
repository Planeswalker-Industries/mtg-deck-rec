import { availability, type Availability, type CollectionCopies } from "@mtg/core/collection";
import type { RankCard } from "@mtg/core/scoring";
import { fetchCardsById, rankCardOf } from "./cards";
import { cachedConfig } from "./config-cache";
import type { PublicClient } from "./supabase";

/** Rows per page when reading the twin groups: PostgREST's row cap. */
const TWIN_PAGE_ROWS = 1000;

/**
 * Every card with a rules-identical twin, mapped to its group: the base card (`cards.equivalence_base_id`), the base
 * included. A few hundred cards; cached per instance like the settings, since only a catalog sync changes it.
 */
export function loadTwinGroups(db: PublicClient): Promise<Map<number, number>> {
  return cachedConfig("twin_groups", async () => {
    const groups = new Map<number, number>();
    for (let from = 0; ; from += TWIN_PAGE_ROWS) {
      const { data, error } = await db
        .from("cards")
        .select("id, equivalence_base_id")
        .not("equivalence_base_id", "is", null)
        .is("deleted_at", null)
        .order("id")
        .range(from, from + TWIN_PAGE_ROWS - 1);
      if (error) throw new Error(`Loading functional twins failed: ${error.message}`);
      for (const row of data) {
        if (row.equivalence_base_id === null) continue;
        groups.set(row.id, row.equivalence_base_id);
        groups.set(row.equivalence_base_id, row.equivalence_base_id);
      }
      if (data.length < TWIN_PAGE_ROWS) return groups;
    }
  });
}

/** What the request's collection can supply (T059), or null without one. */
export async function availabilityFor(db: PublicClient, collection: CollectionCopies | null): Promise<Availability | null> {
  return collection ? availability(collection, await loadTwinGroups(db)) : null;
}

/** Rows for the owned cards that may stand in for a twin, read alongside the pool. */
export async function loadStandIns(db: PublicClient, available: Availability | null): Promise<Map<number, RankCard>> {
  const ids = available?.standInIds() ?? [];
  if (ids.length === 0) return new Map();
  const rows = await fetchCardsById(db, ids);
  return new Map([...rows].map(([id, row]) => [id, rankCardOf(row)]));
}
