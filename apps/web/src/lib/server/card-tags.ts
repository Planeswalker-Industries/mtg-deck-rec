import type { CardId, TagId, TagRef } from "@mtg/core/contract";
import { tagRefsFromDocument } from "@mtg/core/search";
import { retryOnTimeout } from "./retry-timeout";
import { fromIndex, loadTagDocuments } from "./search-index";
import type { PublicClient } from "./supabase";

/**
 * Functional tags for a set of cards, batched. The single-card `card_functional_tags` would mean one round trip per
 * card, and a Commander deck has a hundred of them.
 *
 * Cards with no functional tags are left out rather than returned empty, so the caller can tell "no tags" from
 * "not asked for" and the response stays small.
 *
 * From the index this is two cached reads rather than a query that needed `retryOnTimeout` to survive a cold
 * database. The kill switch still applies at read time: card documents carry every tag the hierarchy reaches, and
 * `tagRefsFromDocument` drops the ones the tags collection marks disabled, so turning a tag off takes effect
 * without reindexing 34,800 cards.
 */
export async function fetchCardTags(
  db: PublicClient,
  cardIds: readonly number[],
): Promise<{ cardId: CardId; tags: TagRef[] }[]> {
  const unique = [...new Set(cardIds)];
  if (unique.length === 0) return [];

  const tags = await loadTagDocuments();
  const indexed = tags ? await fromIndex("Card tags", (index) => index.cardsByID(unique)) : null;
  if (indexed && tags) {
    return indexed.value.flatMap((doc) => {
      const refs = tagRefsFromDocument(doc, tags).map((t): TagRef => ({ id: t.id as TagId, slug: t.slug, label: t.label, depth: t.depth }));
      return refs.length > 0 ? [{ cardId: doc.card_id as CardId, tags: refs }] : [];
    });
  }

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
