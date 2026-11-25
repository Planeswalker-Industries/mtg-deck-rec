"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, WandSparkles } from "lucide-react";
import { compareCards, type FixMove } from "@mtg/core/journey";
import { DecisionButtons } from "@/components/cards/card-panel";
import { MOVE_PAIR_GRID, MoveCard, SwapMark } from "@/components/cards/move-card";
import { useBrowseSwipe } from "@/components/cards/use-browse-swipe";
import { PageTour } from "@/components/tour/page-tour";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { SEAL_BUTTON } from "@/lib/constants";
import { PriceTag } from "@/components/cards/buy-price";
import { StatChips, compareCardOf } from "../deck-stats/stat-chips";
import { useStatPreview } from "../deck-stats/stat-preview";
import { PanelError } from "../panel-state";
import { ShuffleDeck } from "../shuffle-deck";
import { SWIPE_COOLDOWN_MS } from "../swipe-rater";
import { FixAutoSheet } from "./fix-auto-sheet";
import { PhaseIntro, StepStatus } from "./journey-stepper";
import { SwipeDone } from "./single-swipe";
import type { DeckJourney } from "./use-deck-journey";
import type { Fix, FixLineLabel } from "./use-fix";

/** "Ramp 10/14": the line's name with its count against the target as shown, where it has one. */
function LineCount({ line }: { line: FixLineLabel }) {
  return (
    <span className="min-w-0">
      <span className="font-semibold text-foreground">{line.label}</span>
      {line.value !== undefined && line.target !== undefined && (
        <span className="font-mono">
          {" "}
          <span className="text-warning">{line.value}</span>/{Math.round(line.target)}
        </span>
      )}
    </span>
  );
}

/**
 * Fix: one paired move at a time, a card out on the left and a card in on the right, for the Deck stats line named in
 * the header. Swap makes the move, Skip passes on the pair (either card may come back in another), and Auto-Fix
 * previews every move left to apply together. The chips under the cards name every line the move changes.
 *
 * Swiping browses and never decides (owner, 2026-11-24): a swipe on the card going out shows the next or previous card
 * to take out for the line, one on the card going in (or its ‹ ›, or the arrow keys) the next or previous card to put
 * in. Swap and Skip act on the pair on screen.
 */
export function FixPhase({ journey, fix, hasCollection }: { journey: DeckJourney; fix: Fix; hasCollection: boolean }) {
  const { move, browse } = fix;
  const lastAt = useRef(0);
  const outSwipe = useBrowseSwipe({
    onNext: browse.nextOut,
    onPrevious: browse.previousOut,
    canNext: browse.canNextOut,
    canPrevious: browse.canPreviousOut,
    tourTarget: "fix.out",
  });
  const inSwipe = useBrowseSwipe({
    onNext: browse.nextIn,
    onPrevious: browse.previousIn,
    canNext: browse.canNextIn,
    canPrevious: browse.canPreviousIn,
    tourTarget: "fix.in",
  });
  /** The plan the auto-fix sheet previews, made when it is asked for; null while the sheet is shut. */
  const [plan, setPlan] = useState<FixMove[] | null>(null);
  useStatPreview(move?.in ?? null, move?.out ?? null);

  // A double tap would otherwise answer the pair that just came up, which the player never saw.
  const act = (accept: boolean) => {
    if (!move || plan !== null || Date.now() - lastAt.current < SWIPE_COOLDOWN_MS) return;
    lastAt.current = Date.now();
    if (accept) fix.accept();
    else fix.skip();
  };

  // Arrow keys browse the cards to put in (as ‹ ›), unless the player is typing somewhere or the auto-fix sheet is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if ((e.key !== "ArrowRight" && e.key !== "ArrowLeft") || !move || plan !== null) return;
      e.preventDefault();
      if (e.key === "ArrowRight") browse.nextIn();
      else browse.previousIn();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const intro = (
    <PhaseIntro title="Fix" brief="Swap one card for another to bring a Deck stats line in line.">
      One card out, one card in, until every Deck stats line is in line.
    </PhaseIntro>
  );
  const toNext = journey.nextStep;

  if (fix.status === "loading" || fix.status === "idle") {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <ShuffleDeck label="Checking the deck against its stats" />
      </div>
    );
  }
  if (fix.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <PanelError message={fix.message ?? "Couldn't load the cards for Fix."} />
      </div>
    );
  }

  if (!move) {
    const fixed = journey.state?.fixes.length ?? 0;
    const left = fix.lines.length;
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <SwipeDone
          title={left === 0 ? "Looking good!" : fixed > 0 ? "That's every move" : "Nothing to fix here"}
          message={
            left === 0
              ? fixed > 0
                ? `${fixed} ${fixed === 1 ? "card" : "cards"} swapped. Next, swap weaker cards for better ones.`
                : "Next, swap weaker cards for better ones."
              : `${left} ${left === 1 ? "line has" : "lines have"} no move left. Finish says why for each.`
          }
        >
          {/* The screen's one way on, so the seal (owner, 2026-11-25). */}
          <button type="button" className={SEAL_BUTTON} onClick={toNext}>
            Let&apos;s Go!
          </button>
        </SwipeDone>
      </div>
    );
  }

  const inCard = fix.inCard;
  const notOwned = inCard !== null && hasCollection && inCard.owned === null;
  const price = move.in.price;
  const outBrowsable = browse.canNextOut || browse.canPreviousOut;
  const outName = displayName(move.out);
  const inName = displayName(move.in);

  return (
    <div className="flex flex-col gap-3">
      {intro}
      <StepStatus
        reason={<LineCount line={fix.lineLabel(move.line)} />}
        count={
          <>
            {/* "1 of 12": the word "line" is read out, not shown (owner, 2026-11-18). */}
            <span className="sr-only">Line </span>
            {fix.position} of {fix.total}
          </>
        }
      />
      <section aria-label="Fix: one card out, one card in" className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        {/* The trade the tour reads out: the pair, what it changes and its two buttons, not Auto-Fix. */}
        <div data-tour="fix.trade" className="flex flex-col gap-3">
        <div aria-live="polite" data-tour="fix.pair" className={MOVE_PAIR_GRID}>
          <MoveCard
            card={move.out}
            side="out"
            // One card to take out has nothing to browse to: no ‹ ›, and the tour reads it out instead of asking for a swipe.
            {...(outBrowsable && {
              browse: { canPrevious: browse.canPreviousOut, canNext: browse.canNextOut, onPrevious: browse.previousOut, onNext: browse.nextOut },
            })}
            swipe={outSwipe.bind}
            tourTarget={outBrowsable ? "fix.out" : "fix.out-only"}
          />
          <SwapMark />
          <MoveCard
            card={move.in}
            side="in"
            browse={{ canPrevious: browse.canPreviousIn, canNext: browse.canNextIn, onPrevious: browse.previousIn, onNext: browse.nextIn }}
            swipe={inSwipe.bind}
            tourTarget="fix.in"
            owned={hasCollection && inCard !== null && inCard.owned !== null}
            note={
              notOwned ? (
                <span className="font-mono">
                  Not owned · <PriceTag price={price} lower />
                </span>
              ) : null
            }
          />
        </div>
        <StatChips
          add={move.in}
          remove={move.out}
          marks={compareCards(compareCardOf(move.out), compareCardOf(move.in))}
          all
          className="justify-center"
        />
        <DecisionButtons
          tone="primary"
          tour="fix"
          pass={{ word: "Skip", label: `Skip swapping ${outName} for ${inName}`, onClick: () => act(false) }}
          accept={{ word: "Swap", label: `Swap ${outName} for ${inName}`, icon: ArrowLeftRight, onClick: () => act(true) }}
        />
        </div>
        {/* Outline, under the pair: a way out of going one move at a time, never louder than Swap. */}
        <Button
          type="button"
          size="lg"
          variant="outline"
          data-tour="fix.auto"
          onClick={() => setPlan(fix.plan())}
          className="self-center"
        >
          <WandSparkles aria-hidden />
          Auto-Fix
        </Button>
      </section>
      <PageTour id="fix" />
      {plan !== null && (
        <FixAutoSheet
          moves={plan}
          lineLabel={(line) => fix.lineLabel(line).label}
          scoreWith={fix.scoreWith}
          onCancel={() => setPlan(null)}
          onApply={(chosen) => {
            setPlan(null);
            fix.applyPlan(chosen);
          }}
        />
      )}
    </div>
  );
}
