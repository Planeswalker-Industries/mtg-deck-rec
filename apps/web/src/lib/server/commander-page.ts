import type { AddSuggestion, CardCategory, CardSummary, CommanderKeyId, CommanderPageData } from "@mtg/core/contract";
import { ADD_WEIGHTS, blendScore, cardCategory, commanderCorpusScore } from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary } from "./cards";
import { commanderKeyCounts, loadCardCorpus, loadCommanderCorpus } from "./corpus";
import { fetchTags, loadRoleTargets } from "./recs";
import type { PublicClient } from "./supabase";

/** Cards read per commander before ranking; plenty for 12 per card type. */
const TOP_POOL = 500;
const PER_CATEGORY = 12;
const CATEGORY_ORDER: readonly CardCategory[] = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "battle", "land"];

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Data for a public commander page: what that commander's corpus decks run most, by card type and ranked by play rate
 * (the same release-aware rates the deck tool uses, including decks borrowed from other pairings), plus how many cards
 * those decks run in each role. Null when the slug is unknown or no deck has exactly these commanders.
 */
export async function loadCommanderPage(db: PublicClient, slug: string): Promise<CommanderPageData | null> {
  const { data: key, error } = await db
    .from("commander_keys")
    .select("id, slug, commander_1, commander_2, color_identity")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Loading commander failed: ${error.message}`);
  if (!key) return null;

  const commanderIds = key.commander_2 === null ? [key.commander_1] : [key.commander_1, key.commander_2];
  const [corpus, commanderRows, roleTargets, statsResult] = await Promise.all([
    loadCommanderCorpus(db, commanderIds),
    fetchCardsById(db, commanderIds),
    loadRoleTargets(db),
    db.from("commander_stats").select("computed_at").eq("commander_key_id", key.id).maybeSingle(),
  ]);
  if (statsResult.error) throw new Error(`Loading commander stats failed: ${statsResult.error.message}`);
  // Borrowed decks only fill in: a page for commanders nobody has run together would describe other decks.
  if (corpus.ownDeckCount === 0) return null;

  // Ordered by the same play-rate score as cards to add, over own and borrowed decks at their weights.
  const { data: pool, error: poolError } = await db.rpc("rec_add_candidates", {
    p_key_ids: corpus.sourceKeyIds,
    p_key_weights: corpus.sources.map((s) => s.weight),
    p_alpha: corpus.settings.shrinkAlpha,
    p_identity_mask: key.color_identity,
    p_exclude: commanderIds,
    p_allow_game_changers: true,
    p_limit: TOP_POOL,
  });
  if (poolError) throw new Error(`Loading commander cards failed: ${poolError.message}`);
  const cardIds = (pool ?? []).map((p) => p.card_id);

  const [cardRows, cardCorpus, roleTags] = await Promise.all([
    fetchCardsById(db, cardIds),
    loadCardCorpus(db, corpus, cardIds),
    fetchTags(
      db,
      roleTargets.map((t) => t.roleId),
    ),
  ]);

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
  const keyRef = {
    id: key.id as CommanderKeyId,
    slug: key.slug,
    commanders,
    ...commanderKeyCounts(corpus),
  };

  return {
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
