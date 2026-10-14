"use client";

import { useEffect, useRef } from "react";
import type { CardId, CardSummary, CommanderKeyId, RecContext } from "@mtg/core/contract";
import { compareCards, type CompareCard } from "@mtg/core/journey";
import { CompactCardPanel, CompareMarks, DecisionButtons } from "@/components/cards/card-panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/cards";
import { useCardRules } from "@/lib/card-rules";
import { describeCostDelta } from "@/lib/format";
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

/** What comparing reads from a card, with its printed body and play rate when known. */
function compareCard(card: CardSummary, power: string | null, toughness: string | null, inclusionRate: number | null): CompareCard {
  return { manaValue: card.manaValue, typeLine: card.typeLine, keywords: card.keywords, priceUsd: card.price?.usd ?? null, inclusionRate, power, toughness };
}

/**
 * A card to replace and one replacement at a time, both in full: the card in the deck on top, the replacement below,
 * and green and red marks for how the replacement compares (cheaper, faster, played more). Answered with the buttons
 * under them or the arrow keys: right swaps it in, left shows the next replacement.
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
  onDecline,
  declined,
  skipTarget,
  startAt,
  preferred,
  cache,
  onFinish,
  viewRef,
}: {
  targets: readonly RaterTarget[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  mode?: SwipeMode;
  /** Deck tool: swaps already picked in this sitting, and where new picks go. */
  picked?: readonly PickedSwap[];
  onPick?: (swap: PickedSwap) => void;
  onVote?: (vote: SwipeVote) => void;
  /** Deck tool: the player kept the card on screen instead of swapping it. */
  onKeep?: (card: CardSummary) => void;
  /** Deck tool: the player passed on a replacement for the card on screen. */
  onDecline?: (target: CardSummary, replacement: CardSummary) => void;
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
  onFinish: () => void;
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
    onDecline,
    declined,
    skipTarget,
    startAt,
    preferred,
    cache,
    onFinish,
  });
  /** When the last answer landed, for SWIPE_COOLDOWN_MS. */
  const lastAt = useRef(0);
  const { target, loaded, candidate } = rater;
  const inRater = mode === "rater";
  const upcoming = loaded?.status === "ready" ? loaded.suggestions.slice(0, PREFETCH_CANDIDATES + 1).map((s) => s.card.id) : [];
  const nextTarget = targets[rater.targetIndex + 1]?.card.id;
  const rulesFor = useCardRules([...(target ? [target.card.id] : []), ...upcoming, ...(nextTarget === undefined ? [] : [nextTarget])]);

  const act = (swapIn: boolean) => {
    if (!candidate || Date.now() - lastAt.current < SWIPE_COOLDOWN_MS) return;
    lastAt.current = Date.now();
    if (swapIn) rater.swapIn();
    else rater.pass();
  };

  // Arrow keys do what the buttons do, unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      act(e.key === "ArrowRight");
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
  const targetRules = rulesFor(target.card.id);
  const candidateRules = candidate ? rulesFor(candidate.card.id) : undefined;
  const marks =
    candidate && targetRules !== undefined && candidateRules !== undefined
      ? compareCards(
          compareCard(target.card, targetRules?.power ?? null, targetRules?.toughness ?? null, target.corpus?.inclusionRate ?? null),
          compareCard(candidate.card, candidateRules?.power ?? null, candidateRules?.toughness ?? null, candidate.corpus?.inclusionRate ?? null),
        )
      : [];
  const keepLabel = `${inRater ? "Skip" : "Keep"} ${targetName}`;

  return (
    <section
      ref={viewRef}
      aria-label={inRater ? "Rate replacements" : "Swipe through cards to replace"}
      className="playmat mx-auto flex w-full max-w-2xl scroll-mt-44 flex-col gap-2 sm:gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground font-mono">
          Card {rater.targetIndex + 1} of {rater.targetCount}
          {inRater ? "" : <span className="max-sm:hidden"> to replace</span>}
          {candidate && !inRater && <span className="sm:hidden"> · option {rater.candidateIndex + 1} of {rater.candidateCount}</span>}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onFinish}>
          {inRater ? "Done" : "Finish"}
        </Button>
      </div>

      <CompactCardPanel card={target.card} rules={targetRules} side="out" dim={!inRater}>
        {/* Keeping is about this card, so it sits with it rather than in a row of its own under the buttons. */}
        <span className="flex flex-wrap items-baseline gap-x-2">
          {reasons.length > 0 && <span>{reasons.join(", ")}</span>}
          {candidate && (
            <button
              type="button"
              aria-label={keepLabel}
              onClick={rater.keep}
              className="relative cursor-pointer text-sm font-semibold text-primary after:absolute after:-inset-2 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {inRater ? "Skip it" : "Keep it"}
            </button>
          )}
        </span>
      </CompactCardPanel>

      <div aria-hidden className="h-px bg-seam max-sm:hidden" />

      {!loaded ? (
        <div role="status" aria-label="Finding replacements" className="grid grid-cols-[minmax(0,2fr)_minmax(0,5fr)] gap-3">
          <Skeleton className="aspect-[488/680] w-full rounded-[4.75%/3.4%] bg-seam" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3 bg-seam" />
            <Skeleton className="h-3 w-full bg-seam" />
            <Skeleton className="h-3 w-5/6 bg-seam" />
          </div>
        </div>
      ) : loaded.status === "error" ? (
        <div className="flex flex-col items-center gap-3">
          <PanelError message={loaded.message} />
          <Button type="button" variant="outline" onClick={rater.keep}>
            {keepLabel}
          </Button>
        </div>
      ) : !candidate ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="max-w-xs text-sm">
            {loaded.suggestions.length === 0
              ? emptySwapMessage[rater.emptyReason ?? "NO_CANDIDATES"]
              : rater.candidateCount === 0
                ? `No other replacements for ${targetName}.`
                : `That's every replacement for ${targetName}.`}
          </p>
          <Button type="button" onClick={rater.keep}>
            {keepLabel}
          </Button>
        </div>
      ) : (
        <>
          <div aria-live="polite" className="flex flex-col gap-2">
            <CompactCardPanel card={candidate.card} rules={candidateRules} side="in">
              <span className="font-mono max-sm:hidden">
                {describeCostDelta(candidate.costDelta)} · {rater.candidateIndex + 1} of {rater.candidateCount}
              </span>
              {candidate.functionalTwin ? (
                <span className="font-drama text-sm text-foreground/85 italic">Same rules as {targetName}, under a different name.</span>
              ) : (
                jobs.length > 0 && <span className="max-sm:hidden">Also does: {jobs.join(", ").toLowerCase()}</span>
              )}
            </CompactCardPanel>
            <CompareMarks marks={marks} label={`How ${displayName(candidate.card)} compares with ${targetName}`} />
          </div>
          <DecisionButtons
            tone="primary"
            pass={{
              word: inRater ? "Not a fit" : "Next one",
              label: inRater ? `Not a fit: ${candidate.card.name}` : `Pass on ${candidate.card.name}`,
              onClick: () => act(false),
            }}
            accept={{
              word: inRater ? "Good fit" : "Swap in",
              label: inRater ? `Good fit: ${candidate.card.name}` : `Swap in ${candidate.card.name}`,
              onClick: () => act(true),
            }}
          />
        </>
      )}
      {rater.voteError && <p className="text-center text-xs text-muted-foreground">{`Your last vote wasn't saved: ${rater.voteError}`}</p>}
    </section>
  );
}
