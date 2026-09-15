"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSummary, CommanderKeyId, CutSuggestion, RecContext, SwapSuggestion } from "@mtg/core/contract";
import { getApis } from "@/lib/api/client";

/** A replacement the player swiped right on: it takes the target's place in the deck. */
export interface PickedSwap {
  target: CardSummary;
  replacement: CardSummary;
}

type Candidates = { status: "ready"; suggestions: SwapSuggestion[] } | { status: "error"; message: string };

/** Replacement lists load for the current card to cut and the next one, so the next card is ready when it comes up. */
const PRELOAD = 2;

/**
 * State for swiping through the cards to cut: one card to cut at a time, its replacements one by one. A right swipe
 * votes for the pair and picks the swap; a left swipe votes against it and shows the next replacement. Every vote carries
 * what the player saw (sitting, position, candidates shown, matched tags).
 */
export function useSwipeRater({
  targets,
  context,
  commanderKeyId,
  picked,
  onPick,
  onFinish,
}: {
  targets: readonly CutSuggestion[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  picked: readonly PickedSwap[];
  onPick: (swap: PickedSwap) => void;
  onFinish: () => void;
}) {
  const [targetIndex, setTargetIndex] = useState(0);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [results, setResults] = useState<ReadonlyMap<number, Candidates>>(new Map());
  const [voteError, setVoteError] = useState<string | null>(null);
  const requested = useRef(new Set<number>());
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    for (const { card } of targets.slice(targetIndex, targetIndex + PRELOAD)) {
      if (requested.current.has(card.id)) continue;
      requested.current.add(card.id);
      void getApis()
        .recs.swap({ context, targetCardId: card.id })
        .then((r) => {
          const next: Candidates = r.ok ? { status: "ready", suggestions: r.data.suggestions } : { status: "error", message: r.error.message };
          setResults((prev) => new Map(prev).set(card.id, next));
        });
    }
  }, [targets, targetIndex, context]);

  const target = targets[targetIndex] ?? null;
  const loaded = target ? results.get(target.card.id) : undefined;
  // A card already picked for an earlier cut is in the deck now, so it isn't offered again.
  const candidates =
    loaded?.status === "ready" ? loaded.suggestions.filter((s) => !picked.some((p) => p.replacement.id === s.card.id)) : [];
  const candidate = candidates[candidateIndex] ?? null;

  function nextTarget() {
    setCandidateIndex(0);
    setVoteError(null);
    if (targetIndex + 1 >= targets.length) onFinish();
    else setTargetIndex(targetIndex + 1);
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
          source: "deck",
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

    if (value === 1) {
      onPick({ target: target.card, replacement: candidate.card });
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
    targetIndex,
    targetCount: targets.length,
    voteError,
    swapIn: () => vote(1),
    pass: () => vote(-1),
    /** Leaves the card in the deck and moves on, without a vote. */
    keep: nextTarget,
  };
}
