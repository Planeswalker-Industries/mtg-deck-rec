"use client";

import type { TagMatch } from "@mtg/core/contract";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { describeCostDelta, formatAsOf, formatPercent } from "@/lib/format";
import { emptySwapMessage } from "@/lib/labels";
import { CardLabel } from "./card-label";
import { PanelError, PanelLoading } from "./panel-state";
import type { SwapState } from "./use-deck-tool";

function describeMatch(m: TagMatch): string {
  if (m.distance === 0 || !m.via) return m.candidateTag.label;
  return `${m.targetTag.label} ≈ ${m.candidateTag.label} (${m.via.label})`;
}

export function SwapSheet({
  swap,
  targetName,
  onClose,
}: {
  swap: SwapState | null;
  targetName: string | null;
  onClose: () => void;
}) {
  const result = swap?.result;
  const asOf = result?.status === "ready" ? result.data.suggestions.find((s) => s.costDelta.asOf)?.costDelta.asOf : null;

  return (
    <Sheet open={swap !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Substitutes for {targetName ?? "this card"}</SheetTitle>
          <SheetDescription>
            Ranked by what the card does, how often decks with your commander play it, and community votes.
            {asOf && ` Cost differences are estimates as of ${formatAsOf(asOf)}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {result?.status === "loading" && <PanelLoading />}
          {result?.status === "error" && <PanelError message={result.message} />}
          {result?.status === "ready" && result.data.suggestions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {emptySwapMessage[result.data.emptyReason ?? "NO_CANDIDATES"]}
            </p>
          )}
          {result?.status === "ready" && (
            <ol className="flex flex-col gap-2">
              {result.data.suggestions.map((s) => {
                const delta = describeCostDelta(s.costDelta);
                const saves = s.costDelta.usd !== null && s.costDelta.usd < 0;
                return (
                  <li key={s.card.id} className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <CardLabel card={s.card} />
                      {s.owned && <Badge variant="secondary">Owned</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">
                        match {Math.round(s.score.total * 100)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {s.matchedTags.map((m) => (
                        <Badge key={`${m.targetTag.id}:${m.candidateTag.id}`} variant="outline">
                          {describeMatch(m)}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {s.corpus
                          ? `in ${formatPercent(s.corpus.inclusionRate)} of ${s.corpus.commanderDeckCount.toLocaleString("en-US")} decks`
                          : "No deck data"}
                      </span>
                      <span className={saves ? "font-medium text-emerald-700 dark:text-emerald-400" : undefined}>
                        {delta}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
