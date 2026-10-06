import { isStatementTimeout, recordRecTimeout, retryOnTimeout } from "./retry-timeout";
import type { CardSummary, CommanderKeyId, RaterDeal } from "@mtg/core/contract";
import { fetchCardsById, toCardSummary, type CardRow } from "./cards";
import { commanderKeyCounts, loadCommanderCorpus, type CommanderCorpus } from "./corpus";
import { NotFoundError } from "./recs";
import { loadServedDeckPool, loadServingReads } from "./serving";
import type { PublicClient } from "./supabase";

/** Cards considered per commander, most played first; the rater deals rounds from these at random. */
const DEAL_POOL = 80;
const DEAL_SIZE = 40;

const isLand = (typeLine: string) => /\bLand\b/.test(typeLine.split(" // ")[0] ?? typeLine);

interface Deal {
  corpus: CommanderCorpus;
  commanderRows: ReadonlyMap<number, CardRow>;
  poolIds: readonly number[];
  poolRows: ReadonlyMap<number, CardRow>;
}

/** The rater's pool from rec_add_candidates, the path before the serving tables (T055): three rounds. */
async function dealFromAddCandidates(db: PublicClient, commanderIds: number[]): Promise<Deal> {
  const [commanderRows, corpus] = await Promise.all([fetchCardsById(db, commanderIds), loadCommanderCorpus(db, commanderIds)]);
  const identityMask = commanderIds.reduce((mask, id) => mask | (commanderRows.get(id)?.color_identity ?? 0), 0);
  const { data: pool, error } = await retryOnTimeout("Dealing rater cards", () =>
    db.rpc("rec_add_candidates", {
      p_key_ids: corpus.sourceKeyIds,
      p_key_weights: corpus.sources.map((s) => s.weight),
      p_alpha: corpus.settings.shrinkAlpha,
      p_identity_mask: identityMask,
      p_exclude: commanderIds,
      p_allow_game_changers: true,
      p_limit: DEAL_POOL,
    }),
  );
  if (error) {
    if (isStatementTimeout(error)) recordRecTimeout(db, { fn: "add", commanderIds, identityMask });
    throw new Error(`Dealing rater cards failed: ${error.message}`);
  }
  const poolIds = (pool ?? []).map((p) => p.card_id);
  return { corpus, commanderRows, poolIds, poolRows: await fetchCardsById(db, poolIds) };
}

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

  // One round on the serving tables: the commanders, their corpus and the pool with its cards go out together.
  const { corpus, commanderRows, poolIds, poolRows } = (await loadServingReads(db))
    ? await loadServedDeckPool(db, { commanderIds, exclude: commanderIds, limit: DEAL_POOL }).then((d) => ({
        corpus: d.corpus,
        commanderRows: d.commanderRows,
        poolIds: d.poolIds,
        poolRows: d.pool.rows,
      }))
    : await dealFromAddCandidates(db, commanderIds);
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
