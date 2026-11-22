import { displayName } from "@/lib/cards";
import { formatAsOf, formatUsd } from "@/lib/format";
import type { DeckPageData } from "@/lib/server/deck-page";

/**
 * A saved deck's link-preview title and description: "{name} — {commanders} deck" and what it holds, with its
 * estimated total and the oldest price date among the cards counted. A deck with no priced card leaves the price
 * clause out; one with no commander is just a "Commander deck".
 */
export function deckShareText(deck: Pick<DeckPageData, "name" | "commanders" | "groups" | "cardCount">): {
  title: string;
  description: string;
} {
  const names = deck.commanders.map(displayName).join(" and ");
  const priced = [
    ...deck.commanders.map((card) => ({ price: card.price, quantity: 1 })),
    ...deck.groups.flatMap((g) => g.cards.map(({ card, quantity }) => ({ price: card.price, quantity }))),
  ].flatMap(({ price, quantity }) => (price ? [{ price, quantity }] : []));

  let priceClause = "";
  if (priced.length > 0) {
    const total = priced.reduce((sum, { price, quantity }) => sum + price.usd * quantity, 0);
    const asOf = priced.map(({ price }) => price.asOf).reduce((oldest, d) => (d < oldest ? d : oldest));
    priceClause = `, ~${formatUsd(total)} (as of ${formatAsOf(asOf)})`;
  }

  const kind = names ? `${names} deck` : "Commander deck";
  return {
    title: `${deck.name} — ${kind}`,
    description: `A ${names ? `${names} ` : ""}Commander deck: ${deck.cardCount} cards${priceClause}. See its cards and get suggestions to add, cut and swap.`,
  };
}
