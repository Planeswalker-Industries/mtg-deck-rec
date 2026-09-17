import type { CardId, TagId, TagRef } from "@mtg/core/contract";
import { retryOnTimeout } from "./retry-timeout";
import type { PublicClient } from "./supabase";

/**
 * Functional tags for a set of cards, batched. The single-card `card_functional_tags` would mean one round trip per
 * card, and a Commander deck has a hundred of them.
 *
 * Cards with no functional tags are left out rather than returned empty, so the caller can tell "no tags" from
 * "not asked for" and the response stays small.
 */
export async function fetchCardTags(
  db: PublicClient,
  cardIds: readonly number[],
): Promise<{ cardId: CardId; tags: TagRef[] }[]> {
  const unique = [...new Set(cardIds)];
  if (unique.length === 0) return [];

  const { data, error } = await retryOnTimeout("Card tags", () =>
    db.rpc("cards_functional_tags", { p_card_ids: unique }),
  );
  if (error) throw new Error(`Loading card tags failed: ${error.message}`);

  const byCard = new Map<number, TagRef[]>();
  for (const row of data ?? []) {
    const tag: TagRef = { id: row.tag_id as TagId, slug: row.slug, label: row.label, depth: row.depth };
    byCard.set(row.card_id, [...(byCard.get(row.card_id) ?? []), tag]);
  }
  return [...byCard].map(([cardId, tags]) => ({ cardId: cardId as CardId, tags }));
}
