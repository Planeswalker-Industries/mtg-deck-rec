"use client";

import type { CardId, CutReason, CutResult } from "@mtg/core/contract";
import { Badge } from "@/components/ui/badge";
import { formatPercent } from "@/lib/format";
import { confidenceMessage, cutReasonLabel } from "@/lib/labels";
import { CardLabel } from "./card-label";
import { PanelError, PanelLoading } from "./panel-state";
import type { Async } from "./use-deck-tool";

const HARD_REASONS = new Set<CutReason>([
  "NOT_LEGAL",
  "OUTSIDE_COLOR_IDENTITY",
  "GAME_CHANGER_EXCLUDED",
  "OVER_BRACKET_GC_LIMIT",
]);

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
  if (state.status === "loading") return <PanelLoading />;
  if (state.status === "error") return <PanelError message={state.message} />;

  const { suggestions, confidence } = state.data;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {confidenceMessage(confidence, commanderDeckCount)} Click a card to see substitutes.
      </p>
      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing stands out to cut.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {suggestions.map((s) => (
            <li key={s.card.id}>
              <button
                type="button"
                onClick={() => onSelectCard(s.card.id)}
                data-selected={s.card.id === selectedCardId}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-muted data-[selected=true]:bg-muted"
              >
                <CardLabel card={s.card} />
                <span className="flex flex-wrap gap-1">
                  {s.reasons.map((reason) => (
                    <Badge key={reason} variant={HARD_REASONS.has(reason) ? "destructive" : "secondary"}>
                      {cutReasonLabel[reason]}
                    </Badge>
                  ))}
                </span>
                {s.corpus && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    in {formatPercent(s.corpus.inclusionRate)} of decks
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
