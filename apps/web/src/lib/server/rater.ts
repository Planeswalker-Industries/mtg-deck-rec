import type { CardSummary, CommanderKeyId, RaterDeal } from "@mtg/core/contract";
import { toCardSummary } from "./cards";
import { commanderKeyCounts } from "./corpus";
import { NotFoundError } from "./recs";
import { loadServedDeckPool } from "./serving";
import type { PublicClient } from "./supabase";

/** Cards considered per commander, most played first; the rater deals rounds from these at random. */
const DEAL_POOL = 80;
const DEAL_SIZE = 40;

const isLand = (typeLine: string) => /\bLand\b/.test(typeLine.split(" // ")[0] ?? typeLine);

/**
 * Cards for the standalone rater: what the commander's decks play most (the same play-rate ordering as cards to add,
 * borrowing partner decks like the deck tool), or cards widely played in its colors when it has no decks. Lands are
 * left out, since their replacements are rarely worth rating.
 */
export async function dealRaterCards(
  db: PublicClient,
  input: { commanderIds?: number[] | undefined; commanderSlug?: string | undefined },
): Promise<RaterDeal> {
  let ids = input.commanderIds;
  if (!ids) {
    const { data: key, error } = await db
      .from("commander_keys")
      .select("commander_1, commander_2")
      .eq("slug", input.commanderSlug ?? "")
      .maybeSingle();
    if (error) throw new Error(`Loading commander failed: ${error.message}`);
    if (!key) throw new NotFoundError("That commander isn't in our deck data.");
    ids = key.commander_2 === null ? [key.commander_1] : [key.commander_1, key.commander_2];
  }
  const commanderIds = [...new Set(ids)].sort((a, b) => a - b);

  // One round: the commanders, their corpus and the pool with its cards go out together.
  const { corpus, commanderRows, poolIds, pool } = await loadServedDeckPool(db, { commanderIds, exclude: commanderIds, limit: DEAL_POOL });
  const poolRows = pool.rows;
  if (!commanderIds.every((id) => commanderRows.has(id)) || !commanderIds.some((id) => commanderRows.get(id)?.can_be_commander)) {
    throw new NotFoundError("That card can't lead a Commander deck.");
  }
  const cards = poolIds
    .flatMap((id): CardSummary[] => {
      const row = poolRows.get(id);
      return row && !isLand(row.type_line) ? [toCardSummary(row)] : [];
    })
    .slice(0, DEAL_SIZE);

  return {
    commanderKey: {
      id: corpus.keyId as CommanderKeyId | null,
      slug: corpus.slug,
      commanders: commanderIds.flatMap((id) => {
        const row = commanderRows.get(id);
        return row ? [toCardSummary(row)] : [];
      }),
      ...commanderKeyCounts(corpus),
    },
    cards,
  };
}
