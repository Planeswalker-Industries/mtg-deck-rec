"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSummary, CommanderKeyId, CutReason, RecContext, SwapSuggestion } from "@mtg/core/contract";
import { getApis } from "@/lib/api/client";
import { shuffled } from "@/lib/shuffle";

/** A replacement the player swiped right on in the deck tool: it takes the target's place in the deck. */
export interface PickedSwap {
  target: CardSummary;
  replacement: CardSummary;
}

/** A card to find replacements for: a card to cut, with its reasons, in the deck tool; a dealt card in the rater. */
export interface RaterTarget {
  card: CardSummary;
  reasons?: readonly CutReason[];
}

/**
 * "deck": the deck tool. Replacements come best first; a right swipe picks the swap and moves on to the next card to
 * cut. "rater": the standalone card rater. A card's top replacements come shuffled, so ratings aren't nudged by our
 * ranking; every swipe moves to the next replacement, and the next card comes up once all of them are rated.
 */
export type SwipeMode = "deck" | "rater";

export interface SwipeVote {
  target: CardSummary;
  replacement: CardSummary;
  value: 1 | -1;
}

type Candidates = { status: "ready"; suggestions: SwapSuggestion[] } | { status: "error"; message: string };

/** Replacement lists load for the current card and the next one, so the next card is ready when it comes up. */
const PRELOAD = 2;
/** How many of a card's top replacements the rater shows. */
const RATER_CANDIDATES = 6;

/**
 * State for swiping through cards and their replacements, one at a time. Every vote carries what the player saw
 * (sitting, position, candidates shown, matched tags).
 */
export function useSwipeRater({
  targets,
  context,
  commanderKeyId,
  mode = "deck",
  picked = [],
  onPick,
  onVote,
  onFinish,
}: {
  targets: readonly RaterTarget[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  mode?: SwipeMode | undefined;
  picked?: readonly PickedSwap[] | undefined;
  onPick?: ((swap: PickedSwap) => void) | undefined;
  onVote?: ((vote: SwipeVote) => void) | undefined;
  onFinish: () => void;
}) {
  const [targetIndex, setTargetIndex] = useState(0);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [results, setResults] = useState<ReadonlyMap<number, Candidates>>(new Map());
  const [voteError, setVoteError] = useState<string | null>(null);
  const requested = useRef(new Set<number>());
  const sessionId = useRef<string | null>(null);

  // The rater passes over cards that turn out to have no replacements: there's nothing to rate.
  let index = targetIndex;
  while (mode === "rater" && index < targets.length) {
    const r = results.get(targets[index]?.card.id ?? -1);
    if (r?.status !== "ready" || r.suggestions.length > 0) break;
    index++;
  }
  const allSkipped = mode === "rater" && targets.length > 0 && index >= targets.length;

  useEffect(() => {
    if (allSkipped) onFinish();
  }, [allSkipped, onFinish]);

  useEffect(() => {
    for (const { card } of targets.slice(index, index + PRELOAD)) {
      if (requested.current.has(card.id)) continue;
      requested.current.add(card.id);
      void getApis()
        .recs.swap({ context, targetCardId: card.id })
        .then((r) => {
          const next: Candidates = r.ok
            ? { status: "ready", suggestions: mode === "rater" ? shuffled(r.data.suggestions.slice(0, RATER_CANDIDATES)) : r.data.suggestions }
            : { status: "error", message: r.error.message };
          setResults((prev) => new Map(prev).set(card.id, next));
        });
    }
  }, [targets, index, context, mode]);

  const target = targets[index] ?? null;
  const loaded = target ? results.get(target.card.id) : undefined;
  // In the deck tool, a card already picked for an earlier cut is in the deck now, so it isn't offered again.
  const candidates =
    loaded?.status === "ready" ? loaded.suggestions.filter((s) => !picked.some((p) => p.replacement.id === s.card.id)) : [];
  const candidate = candidates[candidateIndex] ?? null;

  function nextTarget() {
    setCandidateIndex(0);
    setVoteError(null);
    if (index + 1 >= targets.length) onFinish();
    else setTargetIndex(index + 1);
  }

  function vote(value: 1 | -1) {
    if (!target || !candidate) return;
    sessionId.current ??= crypto.randomUUID();
    const matchedTagIds = [...new Set(candidate.matchedTags.map((m) => m.candidateTag.id))];
    void getApis()
      .actions.castVote({
        targetCardId: target.card.id,
        replacementCardId: candidate.card.id,
        value,
        ...(commanderKeyId !== null ? { commanderKeyId } : {}),
        context: {
          source: mode === "rater" ? "rater" : "deck",
          sessionId: sessionId.current,
          commanderIds: context.deck.commanders,
          position: candidateIndex,
          shownCardIds: candidates.map((c) => c.card.id),
          matchedTagIds,
        },
      })
      .then((r) => {
        if (!r.ok) setVoteError(r.error.message);
      });
    onVote?.({ target: target.card, replacement: candidate.card, value });

    if (mode === "rater") {
      if (candidateIndex + 1 >= candidates.length) nextTarget();
      else setCandidateIndex(candidateIndex + 1);
    } else if (value === 1) {
      onPick?.({ target: target.card, replacement: candidate.card });
      nextTarget();
    } else {
      setCandidateIndex(candidateIndex + 1);
    }
  }

  return {
    target,
    /** undefined while the replacements are loading. */
    loaded,
    candidate,
    candidateIndex,
    candidateCount: candidates.length,
    targetIndex: index,
    targetCount: targets.length,
    voteError,
    swapIn: () => vote(1),
    pass: () => vote(-1),
    /** Moves on to the next card without a vote: keeps the card in the deck tool, skips it in the rater. */
    keep: nextTarget,
  };
}
