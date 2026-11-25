"use client";

import { useEffect, useRef } from "react";
import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import type { CardId, CardSummary, CommanderKeyId, RecContext } from "@mtg/core/contract";
import { compareCards } from "@mtg/core/journey";
import { ownedOnly, swapMatchLabel } from "@mtg/core/scoring";
import { BuyPrice } from "@/components/cards/buy-price";
import { usePreloadCardImages } from "@/components/cards/dealt-card";
import { useBrowseSwipe } from "@/components/cards/use-browse-swipe";
import { DecisionButtons } from "@/components/cards/card-panel";
import { BrowseCount, MOVE_PAIR_GRID, MoveCard, SwapMark } from "@/components/cards/move-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/cards";
import { useCardRules } from "@/lib/card-rules";
import { CARD_IMAGES_AHEAD } from "@/lib/constants";
import { StatChips, compareCardOf } from "./deck-stats/stat-chips";
import { useStatPreview } from "./deck-stats/stat-preview";
import { cutReasonShortLabel, emptySwapMessage } from "@/lib/labels";
import { PanelError } from "./panel-state";
import { ShuffleDeck } from "./shuffle-deck";
import { useSwipeRater, type Candidates, type PickedSwap, type RaterTarget, type SwipeMode, type SwipeVote } from "./use-swipe-rater";

/**
 * After an answer lands, the next one waits this long. A double tap on a button would otherwise answer the card that
 * just came up, which the player never saw.
 */
export const SWIPE_COOLDOWN_MS = 500;
/** Cut reasons under the card being replaced. */
const MAX_REASONS = 2;
/** Shared jobs named under the replacement. */
const MAX_JOBS = 4;
/** Replacements after the one on screen whose rules text is fetched ahead. */
const PREFETCH_CANDIDATES = 4;

/**
 * A card to replace and one replacement at a time, side by side as in Fix: the card to remove on the left, the one to
 * add on the right, and green and red marks for how the replacement compares (cheaper to cast, faster, popular). The
 * replacement's ‹ › go through its options; Skip and Swap under them decide about the card (owner, 2026-11-23: browsing
 * sits with what it browses, the bottom row only decides, like a spell checker). Swiping browses and never decides
 * (owner, 2026-11-24): a swipe on the card going out shows the next or previous card to replace, one on the card going
 * in the next or previous option, as ‹ › and the arrow keys do. The rater keeps its own answers: Not a fit and Good
 * fit, with Skip under them, and the arrow keys answer them.
 */
export function SwipeRater({
  targets,
  context,
  commanderKeyId,
  mode = "deck",
  picked,
  onPick,
  onVote,
  onKeep,
  declined,
  skipTarget,
  startAt,
  preferred,
  cache,
  skipEmpty,
  onFinish,
  finishButton = true,
  onNothingDealt,
  viewRef,
}: {
  targets: readonly RaterTarget[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  mode?: SwipeMode;
  /** Deck tool: swaps already picked in this sitting, and where new picks go. */
  picked?: readonly PickedSwap[];
  /** Deck tool: a swap picked, with the options seen before it, passed over (see useSwipeRater). */
  onPick?: (swap: PickedSwap, passedOver: readonly CardId[]) => void;
  onVote?: (vote: SwipeVote) => void;
  /** Deck tool: the player kept the card on screen instead of swapping it. */
  onKeep?: (card: CardSummary) => void;
  /** Deck tool: replacements passed on in earlier sittings, not offered again for that card. */
  declined?: readonly { targetId: CardId; replacementId: CardId }[];
  /** Deck tool: a card to step over when its turn comes (no longer in the deck). */
  skipTarget?: (card: CardSummary) => boolean;
  /** Deck tool: the card to open on, rather than the first. */
  startAt?: CardId;
  /** Deck tool: a replacement to deal first for `startAt`. */
  preferred?: CardId;
  /** Deck tool: replacements already fetched for this list, by card (see useSwipeRater). */
  cache?: Map<CardId, Candidates>;
  /** Deck tool: step over a card with no replacement on any rung instead of showing it empty (see useSwipeRater). */
  skipEmpty?: boolean;
  onFinish: () => void;
  /** Show the Finish (Done) button beside the count; false where the page already offers it (Swap's stepper). */
  finishButton?: boolean;
  /** The sitting ended without dealing a replacement (see useSwipeRater). */
  onNothingDealt?: () => void;
  /** Receives the view's element once it shows cards (not while the deck is still shuffling), e.g. to scroll it into place. */
  viewRef?: (element: HTMLElement | null) => void;
}) {
  const rater = useSwipeRater({
    targets,
    context,
    commanderKeyId,
    mode,
    picked,
    onPick,
    onVote,
    onKeep,
    declined,
    skipTarget,
    startAt,
    preferred,
    cache,
    skipEmpty,
    onFinish,
    onNothingDealt,
  });
  /** When the last answer landed, for SWIPE_COOLDOWN_MS. */
  const lastAt = useRef(0);
  const { target, loaded, candidate } = rater;
  const inRater = mode === "rater";
  // Deck tool: left shows the next card or option, right the previous one. The rater doesn't browse.
  const targetSwipe = useBrowseSwipe({
    onNext: rater.nextTarget,
    onPrevious: rater.previousTarget,
    canNext: rater.canNextTarget,
    canPrevious: rater.canPreviousTarget,
    tourTarget: inRater ? undefined : "swap.out",
  });
  const optionSwipe = useBrowseSwipe({
    onNext: rater.nextOption,
    onPrevious: rater.back,
    canNext: rater.canNextOption,
    canPrevious: rater.canBackOption,
    tourTarget: inRater ? undefined : "swap.in",
  });
  const upcoming = loaded?.status === "ready" ? loaded.suggestions.slice(0, PREFETCH_CANDIDATES + 1).map((s) => s.card.id) : [];
  const nextTarget = targets[rater.targetIndex + 1]?.card.id;
  const rulesFor = useCardRules([...(target ? [target.card.id] : []), ...upcoming, ...(nextTarget === undefined ? [] : [nextTarget])]);
  useStatPreview(candidate?.card ?? null, candidate && target ? target.card : null);
  // The cards a browse deals next, on either side, so they show face up (T104).
  usePreloadCardImages([
    ...rater.nextCandidates.slice(0, CARD_IMAGES_AHEAD).map((s) => s.card),
    ...targets.slice(rater.targetIndex + 1, rater.targetIndex + 1 + CARD_IMAGES_AHEAD).map((t) => t.card),
  ]);

  /** Every answer waits out the cooldown, so a double tap can't answer what came up after the first. */
  const act = (answer: "swap" | "pass" | "skip") => {
    if (!candidate || Date.now() - lastAt.current < SWIPE_COOLDOWN_MS) return;
    lastAt.current = Date.now();
    if (answer === "swap") rater.swapIn();
    else if (answer === "pass") rater.pass();
    else rater.keep();
  };

  // Arrow keys browse the options here (as ‹ ›) and answer in the rater, unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      // The rater: Good fit or Not a fit, as the buttons under the cards.
      if (inRater) act(e.key === "ArrowRight" ? "swap" : "pass");
      else if (e.key === "ArrowRight") rater.nextOption();
      else rater.back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!target) return null;
  // Until the first card's replacements arrive, the deck keeps shuffling.
  if (rater.targetIndex === 0 && !loaded) {
    return <ShuffleDeck label="Finding replacements" />;
  }
  const targetName = displayName(target.card);
  const reasons = (target.reasons ?? []).map((r) => cutReasonShortLabel[r]).slice(0, MAX_REASONS);
  const jobs = candidate
    ? [...new Set(candidate.matchedTags.map((m) => (m.distance === 0 || !m.via ? m.candidateTag.label : m.via.label)))].slice(0, MAX_JOBS)
    : [];
  // A looser rung of the swap ladder says which one it is (T088): "Same job: ramp", "Similar slot: 5-mana creature".
  const rungLabel = candidate ? swapMatchLabel(candidate, target.card) : null;
  const targetRules = rulesFor(target.card.id);
  const candidateRules = candidate ? rulesFor(candidate.card.id) : undefined;
  // Owned replacements are marked only where they mix with cards to buy: in Owned only every one is owned.
  const markOwned = context.ownership !== null && !ownedOnly(context);
  const marks =
    candidate && targetRules !== undefined && candidateRules !== undefined
      ? compareCards(
          compareCardOf(target.card, targetRules?.power ?? null, targetRules?.toughness ?? null, target.corpus?.inclusionRate ?? null),
          compareCardOf(candidate.card, candidateRules?.power ?? null, candidateRules?.toughness ?? null, candidate.corpus?.inclusionRate ?? null),
        )
      : [];
  const skipLabel = `Skip ${targetName}`;

  /** The rater's counts over each card ("1 of 14"); the deck tool shows none (owner, 2026-11-24). */
  const cardCount = inRater ? <BrowseCount word="Card" index={rater.targetIndex} count={rater.targetCount} /> : undefined;
  const optionCount = inRater ? <BrowseCount word="Option" index={rater.candidateIndex} count={rater.candidateCount} /> : undefined;
  const targetCard = (
    <MoveCard
      card={target.card}
      side="out"
      nav={cardCount}
      note={reasons.length > 0 ? <span>{reasons.join(", ")}</span> : null}
      deal={!inRater}
      {...(inRater
        ? {}
        : {
            swipe: targetSwipe.bind,
            tourTarget: "swap.out",
            browse: {
              canPrevious: rater.canPreviousTarget,
              canNext: rater.canNextTarget,
              onPrevious: rater.previousTarget,
              onNext: rater.nextTarget,
            },
          })}
    />
  );

  return (
    <section
      ref={viewRef}
      aria-label={inRater ? "Rate replacements" : "Swipe through cards to replace"}
      className="mx-auto flex w-full max-w-2xl scroll-mt-44 flex-col gap-3"
    >
      {finishButton && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={onFinish}>
            {inRater ? "Done" : "Finish"}
          </Button>
        </div>
      )}

      {!loaded ? (
        <div className={MOVE_PAIR_GRID}>
          {targetCard}
          <SwapMark />
          <div role="status" aria-label="Finding replacements" className="flex min-w-0 flex-col items-center gap-1.5">
            {/* As tall as the word row (and the rater's count row) on the card going in, so both sides stay level. */}
            <div aria-hidden className="min-h-11" />
            {inRater && <div aria-hidden className="-my-1.5 min-h-11" />}
            <Skeleton className="aspect-[488/680] w-full max-w-28 rounded-[4.75%/3.4%] bg-seam sm:max-w-52" />
          </div>
        </div>
      ) : loaded.status === "error" || !candidate ? (
        <>
          <div className="grid grid-cols-2 items-center gap-3">
            {targetCard}
            {loaded.status === "error" ? (
              <PanelError message={loaded.message} />
            ) : (
              <p className="text-center text-sm">
                {loaded.suggestions.length === 0
                  ? emptySwapMessage[rater.emptyReason ?? "NO_CANDIDATES"]
                  : rater.candidateCount === 0
                    ? `No other replacements for ${targetName}.`
                    : `That's every replacement for ${targetName}.`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {/* Past the last option (the options grew fewer while one was on screen): one tap goes back to the last. */}
            {!inRater && rater.candidateIndex > 0 && loaded.status === "ready" && (
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={rater.back}
                // The › that had focus went with the options: focus lands here rather than on the page.
                ref={(el) => {
                  if (el && document.activeElement === document.body) el.focus();
                }}
              >
                <ChevronLeft aria-hidden />
                Back to the options
              </Button>
            )}
            <Button type="button" size="lg" aria-label={skipLabel} onClick={rater.keep}>
              Skip
            </Button>
          </div>
        </>
      ) : (
        <>
          <div aria-live="polite" data-tour={inRater ? undefined : "swap.pair"} className={MOVE_PAIR_GRID}>
            {targetCard}
            <SwapMark />
            <MoveCard
              card={candidate.card}
              side="in"
              owned={markOwned && candidate.owned !== null}
              deal={!inRater}
              {...(inRater ? {} : { swipe: optionSwipe.bind, tourTarget: "swap.in" })}
              nav={optionCount}
              browse={
                inRater
                  ? undefined
                  : { canPrevious: rater.canBackOption, canNext: rater.canNextOption, onPrevious: rater.back, onNext: rater.nextOption }
              }
              note={
                <>
                  {/* A replacement to buy shows its price (owner, 2026-11-18); owned ones and the rater's don't. */}
                  {!inRater && candidate.owned === null && <BuyPrice price={candidate.card.price} />}
                  {candidate.functionalTwin ? (
                    <span className="font-drama text-sm text-foreground/85 italic">Same rules as {targetName}, under a different name.</span>
                  ) : rungLabel ? (
                    // Shown at every width, phones included: it is why this card is offered.
                    <span>{rungLabel}</span>
                  ) : (
                    jobs.length > 0 && <span className="max-sm:hidden">Also does: {jobs.join(", ").toLowerCase()}</span>
                  )}
                </>
              }
            />
          </div>
          <StatChips add={candidate.card} remove={target.card} marks={marks} className="justify-center" />
          {inRater ? (
            <>
              <DecisionButtons
                tone="primary"
                pass={{ word: "Not a fit", label: `Not a fit: ${candidate.card.name}`, onClick: () => act("pass") }}
                accept={{ word: "Good fit", label: `Good fit: ${candidate.card.name}`, onClick: () => act("swap") }}
              />
              <div className="-mt-1 flex justify-center">
                <Button type="button" size="sm" variant="link" aria-label={skipLabel} onClick={() => act("skip")}>
                  Skip
                </Button>
              </div>
            </>
          ) : (
            <DecisionButtons
              tone="primary"
              tour="swap"
              pass={{ word: "Skip", label: skipLabel, onClick: () => act("skip") }}
              accept={{ word: "Swap", label: `Swap in ${candidate.card.name}`, icon: ArrowLeftRight, onClick: () => act("swap") }}
            />
          )}
        </>
      )}
      {rater.voteError && <p className="text-center text-xs text-muted-foreground">{`Your last vote wasn't saved: ${rater.voteError}`}</p>}
    </section>
  );
}
