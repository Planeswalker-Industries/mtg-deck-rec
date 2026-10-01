"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CardId, CardSummary, CommanderKeyId } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import type { JourneySwap } from "@mtg/core/journey";
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
 * Everything on a phone's screen above and around the swipe sitting's two cards: the deck bar, the mode row, the
 * stepper and the sitting's own text. The cards share what's left, so ✓ and ✕ stay on screen without
 * scrolling. Read by the card sizes in `SwipeRater` through --swipe-chrome.
 */
const SWIPE_CHROME = { "--swipe-chrome": "36.75rem" } as CSSProperties;

/**
 * Replace: the deck is looked at again as it now stands, and its weaker fits are dealt with a replacement each, like
 * the swipe view always has. The list shows the same cards; tapping one deals just that card.
 *
 * The list stays for the round while the deck before swaps is unchanged, so leaving and coming back picks up at the
 * first card not yet decided, and a swap picked earlier stays on the list with its replacement. Tapping a picked swap
 * takes it back and deals that card again, its replacement first.
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
  /** A picked swap the player tapped to take back: the sitting reopens on its card. Belongs to one version of the list. */
  const [reopened, setReopened] = useState<{ targetId: CardId; replacementId: CardId; version: number; n: number } | null>(null);
  const sitting = useRef<HTMLDivElement>(null);
  const toReview = () => journey.goTo("review");
  const context = journey.workingContext;
  const reopen = reopened?.version === journey.replace.version ? reopened : null;

  // A swap taken back from the list below the sitting: the sitting, which reopened on its card, comes into view.
  useEffect(() => {
    if (reopened) sitting.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [reopened]);

  const intro = (
    <PhaseIntro title="Swap" brief={view === "swipe" ? "Swipe right to swap in, left for the next one." : undefined}>
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
  const onKeep = (card: CardSummary) => journey.replace.keep(card.id);
  const onDecline = (target: CardSummary, replacement: CardSummary) => journey.replace.decline(target.id, replacement.id);
  // A card swapped out or kept is decided, and so is one an undone addition took back out of the deck. The swipe view
  // steps over decided cards when their turn comes, since it deals by position, so coming back picks up at the first
  // card still open.
  const skipTarget = (card: CardSummary) => !journey.replace.inDeck(card.id) || journey.replace.isKept(card.id);
  const toSwipe = targets.map((s) => ({ card: s.card, reasons: s.reasons }));
  const open = targets.filter((s) => !skipTarget(s.card));
  // The list shows open cards and swapped ones, marked; kept cards were decided on and leave it.
  const listed = targets.filter((s) => !skipTarget(s.card) || journey.replace.swapFor(s.card.id));
  const focused = focus === null ? null : toSwipe.find((t) => t.card.id === focus && !skipTarget(t.card));
  const declined = journey.replace.declined;

  /** Takes a picked swap back and deals its card again, with the replacement the player had picked first. */
  function takeBack(swap: JourneySwap) {
    journey.dispatch({ type: "unswap", targetId: swap.target.id });
    setReopened((prev) => ({
      targetId: swap.target.id,
      replacementId: swap.replacement.id,
      version: journey.replace.version,
      n: (prev?.n ?? 0) + 1,
    }));
    if (view === "list") setFocus(swap.target.id);
  }

  const swapList =
    swaps.length > 0 ? (
      <section aria-labelledby="journey-swaps" className="flex flex-col gap-2">
        <h3 id="journey-swaps" className="font-heading text-xl leading-none font-semibold">
          Swaps <span className="text-sm font-normal text-muted-foreground font-mono">{swaps.length}</span>
        </h3>
        <ul aria-label="Swaps picked" className="flex flex-col divide-y divide-seam overflow-hidden rounded-lg border border-seam bg-sleeve">
          {swaps.map((s) => (
            <li key={s.target.id}>
              <button
                type="button"
                aria-label={`Change the swap for ${displayName(s.target)}`}
                onClick={() => takeBack(s)}
                className="grid w-full grid-cols-[3.5rem_1fr_3.5rem] items-center gap-3 p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <CardImage card={s.target} variant="small" alt="" sizes="56px" className="opacity-80 saturate-50" />
                <span className="text-sm leading-snug">
                  <span className="block text-muted-foreground">Out: {displayName(s.target)}</span>
                  <span className="block font-semibold">In: {displayName(s.replacement)}</span>
                </span>
                <CardImage card={s.replacement} variant="small" alt="" sizes="56px" />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Tap a swap to change it.</p>
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
            key={`${focused.card.id}:${reopen?.n ?? 0}`}
            targets={[focused]}
            startAt={reopen?.targetId}
            preferred={reopen?.replacementId}
            cache={journey.replace.candidates}
            context={context}
            commanderKeyId={commanderKeyId}
            picked={picked}
            onPick={onPick}
            onKeep={onKeep}
            onDecline={onDecline}
            declined={declined}
            onFinish={() => setFocus(null)}
          />
        )}
        {open.length === 0 && nothingLeft}
        {listed.length > 0 && (
          <PocketGrid
            zoomable
            label="Cards worth replacing"
            onSelect={(card: CardSummary) => {
              const swap = journey.replace.swapFor(card.id);
              if (swap) takeBack(swap);
              else setFocus(card.id);
            }}
            items={listed.map((s) => {
              const swap = journey.replace.swapFor(s.card.id);
              return {
                card: s.card,
                selected: swap !== null || s.card.id === focus,
                caption: swap ? (
                  <span className="font-semibold text-replace">Swapping for {displayName(swap.replacement)}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {s.reasons
                      .filter((r) => r !== "NOT_OWNED")
                      .slice(0, MAX_REASONS)
                      .map((r) => cutReasonShortLabel[r])
                      .join(", ")}
                  </span>
                ),
              };
            })}
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
    <div className="flex flex-col gap-4" style={SWIPE_CHROME}>
      {intro}
      {open.length === 0 ? (
        nothingLeft
      ) : (
        // Keyed by the targets' version: new settings ask for new targets, and replacements already fetched were made
        // with the old ones, so the sitting starts over rather than keep them. A swap taken back reopens it on its card.
        <div ref={sitting} className="scroll-mt-44">
          <SwipeRater
            key={`${journey.replace.version}:${reopen?.n ?? 0}`}
            targets={toSwipe}
            startAt={reopen?.targetId}
            preferred={reopen?.replacementId}
            cache={journey.replace.candidates}
            context={context}
            commanderKeyId={commanderKeyId}
            picked={picked}
            onPick={onPick}
            onKeep={onKeep}
            onDecline={onDecline}
            declined={declined}
            skipTarget={skipTarget}
            onFinish={toReview}
          />
        </div>
      )}
      {swapList}
    </div>
  );
}
