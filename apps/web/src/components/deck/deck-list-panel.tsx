"use client";

import type { CardId, CardSummary, ResolvedLine } from "@mtg/core/contract";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { GameChangerBadge } from "./card-label";

export function DeckListPanel({
  lines,
  selectedCardId,
  onSelectCard,
}: {
  lines: ResolvedLine[];
  selectedCardId: CardId | null;
  onSelectCard: (cardId: CardId) => void;
}) {
  const entries = lines.flatMap(({ line, resolution }) =>
    resolution.status === "resolved" && line.section === "main" ? [{ card: resolution.card, quantity: line.quantity }] : [],
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Every card in your deck. Tap one to compare replacements.</p>
      <PocketGrid
        label="Your deck"
        onSelect={(card: CardSummary) => onSelectCard(card.id)}
        items={entries.map(({ card, quantity }) => ({
          card,
          selected: card.id === selectedCardId,
          caption:
            card.gameChanger || quantity > 1 ? (
              <span className="flex flex-col items-start gap-0.5">
                {card.gameChanger && <GameChangerBadge />}
                {quantity > 1 && <span className="text-muted-foreground tabular-nums">{quantity} copies</span>}
              </span>
            ) : undefined,
        }))}
      />
    </div>
  );
}
