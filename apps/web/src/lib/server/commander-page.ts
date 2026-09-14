import type { AddSuggestion, CardCategory, CardSummary, CommanderKeyId, CommanderPageData } from "@mtg/core/contract";
import { ADD_WEIGHTS, blendScore, cardCategory, commanderCorpusScore } from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary } from "./cards";
import { loadCardCorpus, loadCommanderCorpus } from "./corpus";
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
 * (the same release-aware rates the deck tool uses), plus how many cards those decks run in each role. Null when the
 * slug is unknown or the commander has no decks.
 */
export async function loadCommanderPage(db: PublicClient, slug: string): Promise<CommanderPageData | null> {
  const { data: key, error } = await db.from("commander_keys").select("id, slug, commander_1, commander_2").eq("slug", slug).maybeSingle();
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
  if (corpus.deckCount === 0 || corpus.sourceKeyIds.length === 0) return null;

  const { data: topRows, error: topError } = await db
    .from("commander_card_stats")
    .select("card_id")
    .in("commander_key_id", corpus.sourceKeyIds)
    .order("inclusion_shrunk", { ascending: false })
    .limit(TOP_POOL);
  if (topError) throw new Error(`Loading commander cards failed: ${topError.message}`);
  const cardIds = [...new Set(topRows.map((r) => r.card_id))].filter((id) => !commanderIds.includes(id));

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
    deckCount: corpus.deckCount,
    confidence: corpus.confidence,
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
