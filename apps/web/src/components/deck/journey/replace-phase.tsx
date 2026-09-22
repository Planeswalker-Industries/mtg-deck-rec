"use client";

import { useState } from "react";
import type { CardId, CardSummary, CommanderKeyId } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { cutReasonShortLabel } from "@/lib/labels";
import { PanelError } from "../panel-state";
import { ShuffleDeck } from "../shuffle-deck";
import { SwipeRater } from "../swipe-rater";
import { NextBar, PhaseIntro } from "./journey-stepper";
import { SwipeDone } from "./single-swipe";
import type { DeckJourney } from "./use-deck-journey";

/** Reasons under a card in the list. */
const MAX_REASONS = 2;

/**
 * Replace: the deck is looked at again as it now stands, and its weaker fits are dealt with a replacement each, like
 * the swipe view always has. The list shows the same cards; tapping one deals just that card.
 */
export function ReplacePhase({
  journey,
  view,
  commanderKeyId,
}: {
  journey: DeckJourney;
  view: "swipe" | "list";
  commanderKeyId: CommanderKeyId | null;
}) {
  const { state: replaceState, targets } = journey.replace;
  const swaps = journey.state?.swaps ?? [];
  const [focus, setFocus] = useState<CardId | null>(null);
  const toReview = () => journey.goTo("review");
  const context = journey.workingContext;

  const intro = (
    <PhaseIntro title="Replace">
      Cards that do their job less well than something else could. Swipe right on a replacement to swap it in, left to see
      the next one, or keep the card.
    </PhaseIntro>
  );

  if (replaceState.status === "loading" || replaceState.status === "idle" || !context) {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <ShuffleDeck label="Looking at the deck again" />
      </div>
    );
  }
  if (replaceState.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <PanelError message={replaceState.message} />
      </div>
    );
  }

  const picked = swaps.map((s) => ({ target: s.target, replacement: s.replacement }));
  const onPick = (swap: { target: CardSummary; replacement: CardSummary }) =>
    journey.dispatch({ type: "swap", target: swap.target, replacement: swap.replacement });
  const toSwipe = targets.map((s) => ({ card: s.card, reasons: s.reasons }));
  const focused = focus === null ? null : toSwipe.find((t) => t.card.id === focus);

  const swapList =
    swaps.length > 0 ? (
      <section aria-labelledby="journey-swaps" className="flex flex-col gap-2">
        <h3 id="journey-swaps" className="font-heading text-xl leading-none font-semibold">
          Swaps <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">{swaps.length}</span>
        </h3>
        <ul aria-label="Swaps picked" className="flex flex-col divide-y divide-seam rounded-lg border border-seam bg-sleeve">
          {swaps.map((s) => (
            <li key={s.target.id} className="grid grid-cols-[3.5rem_1fr_3.5rem_auto] items-center gap-3 p-3">
              <CardImage card={s.target} alt="" sizes="56px" className="opacity-80 saturate-50" />
              <p className="text-sm leading-snug">
                <span className="block text-muted-foreground">Out: {displayName(s.target)}</span>
                <span className="block font-bold">In: {displayName(s.replacement)}</span>
              </p>
              <CardImage card={s.replacement} alt="" sizes="56px" />
              <Button type="button" size="sm" variant="ghost" onClick={() => journey.dispatch({ type: "unswap", targetId: s.target.id })}>
                Undo
              </Button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const nothingLeft = (
    <SwipeDone message={targets.length === 0 ? "Nothing left that something else does clearly better." : "That's every card worth a second look."}>
      <Button type="button" size="lg" onClick={toReview}>
        Next: review the deck
      </Button>
    </SwipeDone>
  );

  if (view === "list") {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        {focused && (
          <SwipeRater
            key={focused.card.id}
            targets={[focused]}
            context={context}
            commanderKeyId={commanderKeyId}
            picked={picked}
            onPick={onPick}
            onFinish={() => setFocus(null)}
          />
        )}
        {targets.length === 0 ? (
          nothingLeft
        ) : (
          <PocketGrid
            zoomable
            label="Cards worth replacing"
            onSelect={(card: CardSummary) => setFocus(card.id)}
            items={targets.map((s) => ({
              card: s.card,
              selected: s.card.id === focus,
              caption: (
                <span className="text-muted-foreground">
                  {s.reasons
                    .filter((r) => r !== "NOT_OWNED")
                    .slice(0, MAX_REASONS)
                    .map((r) => cutReasonShortLabel[r])
                    .join(", ")}
                </span>
              ),
            }))}
          />
        )}
        {swapList}
        <NextBar label="Next: review the deck" onNext={toReview}>
          {swaps.length} swap{swaps.length === 1 ? "" : "s"}
        </NextBar>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {intro}
      {targets.length === 0 ? (
        nothingLeft
      ) : (
        <SwipeRater targets={toSwipe} context={context} commanderKeyId={commanderKeyId} picked={picked} onPick={onPick} onFinish={toReview} />
      )}
      {swapList}
    </div>
  );
}
