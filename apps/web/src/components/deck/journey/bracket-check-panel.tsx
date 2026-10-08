"use client";

import { TriangleAlert } from "lucide-react";
import { gameChangerLimit } from "@mtg/core/commander";
import type { CardSummary } from "@mtg/core/contract";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { bracketLabel, cutReasonShortLabel } from "@/lib/labels";
import type { BracketCheck } from "./use-deck-journey";

/** Why the new bracket makes these cards must-cuts, in one sentence. */
function why({ bracket, mustCuts }: BracketCheck): string {
  if (mustCuts.some((m) => m.reason === "GAME_CHANGER_EXCLUDED")) {
    return `Bracket ${bracketLabel[bracket]} allows no Game Changers, and ${mustCuts.length === 1 ? "this card is one" : "these are"}.`;
  }
  const limit = gameChangerLimit(bracket);
  const least = mustCuts.length === 1 ? "This is the one" : "These are the ones";
  return `Bracket ${bracketLabel[bracket]} allows ${limit} Game Changers and the deck has ${limit + mustCuts.length}. ${least} decks like this play least.`;
}

/**
 * Shown in the Cut step when a bracket change part way through the round made cards must-cuts. Every choice made so
 * far is kept. Cut & Continue takes the cards out and goes on; Revert puts the old bracket back and returns to the step
 * the change interrupted, as it was.
 */
export function BracketCheckPanel({
  check,
  onCutAndContinue,
  onRevert,
}: {
  check: BracketCheck;
  onCutAndContinue: () => void;
  onRevert: () => void;
}) {
  const count = check.mustCuts.length;
  const previous = check.previousBracket === null ? "the estimated bracket" : `bracket ${bracketLabel[check.previousBracket]}`;
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="flex gap-3 rounded-lg border border-cut/40 bg-cut/5 px-4 py-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-cut" strokeWidth={2.5} />
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl leading-tight font-semibold">
            The bracket change makes {count} card{count === 1 ? "" : "s"} must-cut{count === 1 ? "" : "s"} from your deck
          </h2>
          <p className="text-sm">{why(check)}</p>
          <p className="text-sm text-muted-foreground">
            Your cuts, additions and swaps so far are kept. Cut these and carry on, or revert to {previous}.
          </p>
        </div>
      </div>
      <PocketGrid
        zoomable
        label="Must-cuts for this bracket"
        items={check.mustCuts.map(({ card, reason }: { card: CardSummary; reason: keyof typeof cutReasonShortLabel }) => ({
          card,
          mark: "cut" as const,
          caption: <span className="font-semibold text-cut">{cutReasonShortLabel[reason]}</span>,
        }))}
      />
      <div className="sticky bottom-[var(--deck-stats-dock,0px)] z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-seam bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <Button type="button" variant="outline" onClick={onRevert}>
          Revert
        </Button>
        <Button type="button" onClick={onCutAndContinue}>
          Cut &amp; Continue
        </Button>
      </div>
    </div>
  );
}
