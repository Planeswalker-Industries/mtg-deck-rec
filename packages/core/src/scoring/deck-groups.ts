import type { CardSummary, TagRef } from '../contract';

/** How the deck workspace groups a deck. */
export type DeckGrouping = 'type' | 'keyword' | 'tag';

export interface DeckEntry {
  card: CardSummary;
  quantity: number;
}

export interface DeckGroup {
  key: string;
  label: string;
  entries: DeckEntry[];
  /** Copies in this group, not distinct cards. */
  count: number;
}

/**
 * Card types in the order a decklist is usually written. Legendary Creature is deliberately its own group rather
 * than folded into Creature.
 */
const TYPE_ORDER = [
  'Legendary Creature',
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Battle',
  'Land',
] as const;

/** The front face decides, matching how a decklist reads a double-faced card. */
function typeLabel(card: CardSummary): string {
  const front = card.typeLine.split(' // ')[0] ?? card.typeLine;
  const types = front.split('—')[0] ?? front;
  const legendaryCreature = /\bLegendary\b/.test(types) && /\bCreature\b/.test(types);
  if (legendaryCreature) return 'Legendary Creature';
  return TYPE_ORDER.find((t) => t !== 'Legendary Creature' && types.includes(t)) ?? 'Other';
}

const sortEntries = (entries: DeckEntry[]) => [...entries].sort((a, b) => a.card.name.localeCompare(b.card.name));

const countOf = (entries: DeckEntry[]) => entries.reduce((n, e) => n + e.quantity, 0);

/**
 * Groups a deck for display.
 *
 * Under `type` and `keyword` a card can appear in more than one group only because it has more than one keyword;
 * under `tag` it appears in **every** tag it carries, which is the point: the counts answer "how much removal do I
 * have", so they deliberately do not sum to the deck size. Each group therefore carries its own count.
 *
 * Cards with no keyword or no tag are collected into a trailing group rather than dropped, so the deck is never
 * silently incomplete.
 */
export function groupDeck(
  entries: readonly DeckEntry[],
  grouping: DeckGrouping,
  tagsByCardId: ReadonlyMap<number, TagRef[]> = new Map(),
  options: { maxGroups?: number } = {},
): DeckGroup[] {
  if (grouping === 'type') {
    const byLabel = new Map<string, DeckEntry[]>();
    for (const entry of entries) {
      const label = typeLabel(entry.card);
      byLabel.set(label, [...(byLabel.get(label) ?? []), entry]);
    }
    const ordered = [...TYPE_ORDER, 'Other'];
    return ordered.flatMap((label) => {
      const group = byLabel.get(label);
      return group ? [{ key: label, label, entries: sortEntries(group), count: countOf(group) }] : [];
    });
  }

  const byLabel = new Map<string, DeckEntry[]>();
  const without: DeckEntry[] = [];
  for (const entry of entries) {
    const labels =
      grouping === 'keyword'
        ? entry.card.keywords
        : (tagsByCardId.get(entry.card.id) ?? []).map((t) => t.label);
    const unique = [...new Set(labels)];
    if (unique.length === 0) {
      without.push(entry);
      continue;
    }
    for (const label of unique) byLabel.set(label, [...(byLabel.get(label) ?? []), entry]);
  }

  // Biggest group first: the deck's shape is the question, so the largest buckets are the answer.
  const all = [...byLabel]
    .map(([label, group]) => ({ key: label, label, entries: sortEntries(group), count: countOf(group) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  /*
   * Our functional tags are far finer-grained than the mock's five role buckets: a hundred-card deck produced 150
   * tag groups, which is not a view of anything. Keep the largest few and sweep up whatever is left, so the list
   * stays readable without any card disappearing from it.
   */
  const max = options.maxGroups;
  const kept = max !== undefined && all.length > max ? all.slice(0, max) : all;
  const shown = new Set(kept.flatMap((g) => g.entries.map((e) => e.card.id as number)));
  const leftover = entries.filter((e) => !shown.has(e.card.id as number) && !without.includes(e));

  const groups = [...kept];
  const tail = [...leftover, ...without];
  if (tail.length > 0) {
    const label = kept.length < all.length ? 'Other' : grouping === 'keyword' ? 'No keyword' : 'No tag';
    groups.push({ key: label, label, entries: sortEntries(tail), count: countOf(tail) });
  }
  return groups;
}
