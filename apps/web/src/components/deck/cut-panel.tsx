"use client";

import type { CardId, CardSummary, CutResult } from "@mtg/core/contract";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { formatPercent } from "@/lib/format";
import { confidenceMessage, cutReasonLabel, cutReasonShortLabel, HARD_CUT_REASONS } from "@/lib/labels";
import { GameChangerBadge } from "./card-label";
import { PanelError, PanelLoading } from "./panel-state";
import type { Async } from "./use-deck-tool";

export function CutPanel({
  state,
  commanderDeckCount,
  selectedCardId,
  onSelectCard,
}: {
  state: Async<CutResult>;
  commanderDeckCount: number;
  selectedCardId: CardId | null;
  onSelectCard: (cardId: CardId) => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <PanelLoading label="Finding cards to cut" />;
  if (state.status === "error") return <PanelError message={state.message} />;

  const { suggestions, confidence } = state.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm text-muted-foreground">
        Cards that do the least for this deck, most urgent first. Tap one to compare replacements.{" "}
        {confidenceMessage(confidence, commanderDeckCount)}
      </p>
      {suggestions.length === 0 ? (
        <p className="text-sm">Nothing stands out to cut.</p>
      ) : (
        <PocketGrid
          label="Cards to cut"
          onSelect={(card: CardSummary) => onSelectCard(card.id)}
          items={suggestions.map((s) => ({
            card: s.card,
            selected: s.card.id === selectedCardId,
            caption: (
              <span className="flex flex-col items-start gap-0.5">
                {s.card.gameChanger && <GameChangerBadge />}
                {s.reasons
                  .filter((r) => r !== "GAME_CHANGER_EXCLUDED")
                  .slice(0, 2)
                  .map((reason) => (
                    <span
                      key={reason}
                      title={cutReasonLabel[reason]}
                      className={cn(HARD_CUT_REASONS.has(reason) ? "font-bold text-destructive" : "text-muted-foreground")}
                    >
                      {cutReasonShortLabel[reason]}
                    </span>
                  ))}
                {s.reasons.includes("GAME_CHANGER_EXCLUDED") && (
                  <span className="font-bold text-destructive">Not in bracket</span>
                )}
                {s.corpus && (
                  <span className="text-muted-foreground tabular-nums">In {formatPercent(s.corpus.inclusionRate)} of decks</span>
                )}
              </span>
            ),
          }))}
        />
      )}
    </div>
  );
}
