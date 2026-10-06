import type { AddSuggestion, CardCategory, CardSummary, CommanderKeyId, CommanderPageData } from "@mtg/core/contract";
import { ADD_WEIGHTS, blendScore, cardCategory, commanderCorpusScore } from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary, type CardRow } from "./cards";
import { fromIndex } from "./search-index";
import { commanderKeyCounts, loadCommanderCorpus, type CardCorpus, type CommanderCorpus } from "./corpus";
import { loadRoleTags, loadRoleTargets } from "./recs";
import { loadServedCards, loadServedDeckPool } from "./serving";
import type { PublicClient } from "./supabase";

/** Cards read per commander before ranking; plenty for 12 per card type. */
const TOP_POOL = 500;
const PER_CATEGORY = 12;
const CATEGORY_ORDER: readonly CardCategory[] = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "battle", "land"];

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The cards to rank for a commander page with enough decks of its own: its stored play rates, most played first, from
 * the search index or through an index in Postgres. A page that borrows decks reads the precompute's pool instead.
 */
async function loadTopCardIds(db: PublicClient, corpus: CommanderCorpus, commanderIds: readonly number[]): Promise<number[]> {
  // One key, one sort, no join: the index answers this straight out of the collection it is sorted by, already
  // ordered and de-duplicated, and pages it on its own side.
  const indexed = await fromIndex("Commander cards", (index) => index.commanderCardsTop({ keyIds: corpus.sourceKeyIds, limit: TOP_POOL }));
  if (indexed) return [...new Set(indexed.value)].filter((id) => !commanderIds.includes(id));

  const { data, error } = await db
    .from("commander_card_stats")
    .select("card_id")
    .in("commander_key_id", corpus.sourceKeyIds)
    .order("inclusion_shrunk", { ascending: false })
    .limit(TOP_POOL);
  if (error) throw new Error(`Loading commander cards failed: ${error.message}`);
  return [...new Set(data.map((r) => r.card_id))].filter((id) => !commanderIds.includes(id));
}

/**
 * Data for a public commander page: what that commander's corpus decks run most, by card type and ranked by play rate
 * (the same release-aware rates the deck tool uses, including decks borrowed from other pairings), plus how many cards
 * those decks run in each role. Null when the slug is unknown or no deck has exactly these commanders.
 */
export type CommanderPage = CommanderPageData & {
  /** Artist per commander card id, for crediting art shown as a backdrop. */
  artists: Record<number, string | null>;
};

export async function loadCommanderPage(db: PublicClient, slug: string): Promise<CommanderPage | null> {
  const { data: key, error } = await db
    .from("commander_keys")
    .select("id, slug, commander_1, commander_2, color_identity")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Loading commander failed: ${error.message}`);
  if (!key) return null;

  const commanderIds = key.commander_2 === null ? [key.commander_1] : [key.commander_1, key.commander_2];
  const [corpus, commanderRows, roleTargets, roleTags, statsResult] = await Promise.all([
    loadCommanderCorpus(db, commanderIds),
    fetchCardsById(db, commanderIds),
    loadRoleTargets(db),
    loadRoleTags(db),
    db.from("commander_stats").select("computed_at").eq("commander_key_id", key.id).maybeSingle(),
  ]);
  if (statsResult.error) throw new Error(`Loading commander stats failed: ${statsResult.error.message}`);
  // Borrowed decks only fill in: a page for commanders nobody has run together would describe other decks.
  if (corpus.ownDeckCount === 0) return null;

  // A page that borrows decks reads the precompute's pool with its cards in one call; an own-key page lists its cards
  // first, then reads them.
  let cardIds: number[];
  let cardRows: ReadonlyMap<number, CardRow>;
  let cardCorpus: ReadonlyMap<number, CardCorpus>;
  if (corpus.borrowedDeckCount > 0) {
    const deal = await loadServedDeckPool(db, { commanderIds, exclude: commanderIds, limit: TOP_POOL });
    cardIds = deal.poolIds;
    cardRows = deal.pool.rows;
    cardCorpus = deal.pool.rates;
  } else {
    cardIds = await loadTopCardIds(db, corpus, commanderIds);
    const served = await loadServedCards(db, corpus, commanderIds, cardIds);
    cardRows = served.rows;
    cardCorpus = served.rates;
  }

  const suggestions = cardIds.flatMap((id): AddSuggestion[] => {
    const row = cardRows.get(id);
    const rates = cardCorpus.get(id);
    // Banned cards still show up in older decks; a public page shouldn't recommend them.
    if (!row || row.legal_commander !== "legal" || !rates?.commanderRate) return [];
    return [
      {
        card: toCardSummary(row),
        category: cardCategory(row.type_line),
        score: blendScore(
          { tag: null, manaValue: null, staple: null, corpus: round2(commanderCorpusScore(rates.commanderRate)), votes: null, role: null },
          ADD_WEIGHTS,
        ),
        corpus: rates.evidence,
        fillsRoles: [],
        owned: null,
      },
    ];
  });

  const commanders = commanderIds.flatMap((id): CardSummary[] => {
    const row = commanderRows.get(id);
    return row ? [toCardSummary(row)] : [];
  });
  const artists = Object.fromEntries(commanderIds.map((id) => [id, commanderRows.get(id)?.artist ?? null]));
  const keyRef = {
    id: key.id as CommanderKeyId,
    slug: key.slug,
    commanders,
    ...commanderKeyCounts(corpus),
  };

  return {
    artists,
    key: keyRef,
    top: {
      mode: "collection_less",
      commanderKey: keyRef,
      confidence: corpus.confidence,
      groups: CATEGORY_ORDER.map((category) => ({
        category,
        suggestions: suggestions
          .filter((s) => s.category === category)
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, PER_CATEGORY),
      })).filter((g) => g.suggestions.length > 0),
    },
    roleProfile: roleTargets.flatMap((target) => {
      const tag = roleTags.get(target.roleId);
      const average = corpus.roleProfile[target.roleId];
      return tag && average !== undefined ? [{ tag: { ...tag, label: target.label }, avgPerDeck: round1(average) }] : [];
    }),
    computedAt: statsResult.data?.computed_at ?? new Date().toISOString(),
  };
}
