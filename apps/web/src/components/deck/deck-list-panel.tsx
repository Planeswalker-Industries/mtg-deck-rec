"use client";

import type { CardId, ResolvedLine } from "@mtg/core/contract";
import { CardLabel } from "./card-label";

export function DeckListPanel({
  lines,
  selectedCardId,
  onSelectCard,
}: {
  lines: ResolvedLine[];
  selectedCardId: CardId | null;
  onSelectCard: (cardId: CardId) => void;
}) {
  const cards = lines.flatMap(({ line, resolution }) =>
    resolution.status === "resolved" && line.section === "main" ? [{ card: resolution.card, quantity: line.quantity }] : [],
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Click any card to see substitutes.</p>
      <ul className="divide-y rounded-lg border">
        {cards.map(({ card, quantity }) => (
          <li key={card.id}>
            <button
              type="button"
              onClick={() => onSelectCard(card.id)}
              data-selected={card.id === selectedCardId}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted data-[selected=true]:bg-muted"
            >
              <span className="w-5 text-right text-xs text-muted-foreground">{quantity}</span>
              <CardLabel card={card} />
              <span className="ml-auto text-xs text-muted-foreground">{card.typeLine}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
