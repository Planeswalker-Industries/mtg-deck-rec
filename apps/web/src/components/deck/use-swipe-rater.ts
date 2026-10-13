"use client";

import { useEffect, useRef, useState } from "react";
import type { CardId, CardSummary, CommanderKeyId, CutReason, RecContext, SwapResult, SwapSuggestion } from "@mtg/core/contract";
import { getApis } from "@/lib/api/client";
import { recordDecision, recordShown, type RecBatch } from "@/lib/rec-events";
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

/** A card's replacements as fetched: ready, or why they couldn't be. */
export type Candidates = { status: "ready"; suggestions: SwapSuggestion[]; emptyReason: SwapResult["emptyReason"] } | { status: "error"; message: string };

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
  onKeep,
  onDecline,
  declined = [],
  skipTarget,
  startAt,
  preferred,
  cache,
  onFinish,
}: {
  targets: readonly RaterTarget[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  mode?: SwipeMode | undefined;
  picked?: readonly PickedSwap[] | undefined;
  onPick?: ((swap: PickedSwap) => void) | undefined;
  onVote?: ((vote: SwipeVote) => void) | undefined;
  /** Deck tool: the player kept the card rather than swap it, so its host can remember the choice. */
  onKeep?: ((card: CardSummary) => void) | undefined;
  /** Deck tool: the player passed on a replacement for a card, so its host can stop offering it. */
  onDecline?: ((target: CardSummary, replacement: CardSummary) => void) | undefined;
  /**
   * Deck tool: replacements already passed on, by card. Read once, when the sitting opens: one passed on during it is
   * stepped past by position, and dropping it from the list as well would skip the one after it.
   */
  declined?: readonly { targetId: CardId; replacementId: CardId }[] | undefined;
  /** Deck tool: a card to step over when its turn comes, e.g. one no longer in the deck. */
  skipTarget?: ((card: CardSummary) => boolean) | undefined;
  /** Deck tool: the card the sitting opens on, rather than the first; read once, when it opens. */
  startAt?: CardId | undefined;
  /** Deck tool: a replacement dealt first for `startAt`, e.g. the one the player had picked for it before. */
  preferred?: CardId | undefined;
  /**
   * Deck tool: replacements fetched in earlier sittings over the same list, by card, which this sitting adds to. A
   * sitting reopened on the same list (the player went back a step and returned) asks for nothing it already has.
   */
  cache?: Map<CardId, Candidates> | undefined;
  onFinish: () => void;
}) {
  const [targetIndex, setTargetIndex] = useState(() =>
    startAt === undefined ? 0 : Math.max(0, targets.findIndex((t) => t.card.id === startAt)),
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [results, setResults] = useState<ReadonlyMap<number, Candidates>>(() => new Map(cache ?? []));
  const [voteError, setVoteError] = useState<string | null>(null);
  const [declinedAtStart] = useState(() => new Set(declined.map((d) => `${d.targetId}:${d.replacementId}`)));
  const requested = useRef(new Set<number>(cache?.keys() ?? []));
  const sessionId = useRef<string | null>(null);
  /** Deck tool: each card's replacements as recorded for the accept rate (T065), once per sitting. */
  const batches = useRef(new Map<number, RecBatch>());

  // Cards to step over come off the list as their turn comes, rather than out of it: the list is dealt by position.
  // The rater also passes over cards that turn out to have no replacements: there's nothing to rate.
  let index = targetIndex;
  while (index < targets.length) {
    const card = targets[index]!.card;
    if (skipTarget?.(card)) {
      index++;
      continue;
    }
    if (mode !== "rater") break;
    const r = results.get(card.id);
    if (r?.status !== "ready" || r.suggestions.length > 0) break;
    index++;
  }
  const allSkipped = targets.length > 0 && index >= targets.length;

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
            ? { status: "ready", suggestions: mode === "rater" ? shuffled(r.data.suggestions.slice(0, RATER_CANDIDATES)) : r.data.suggestions, emptyReason: r.data.emptyReason }
            : { status: "error", message: r.error.message };
          // A failure isn't kept: the next sitting asks again.
          if (next.status === "ready") cache?.set(card.id, next);
          setResults((prev) => new Map(prev).set(card.id, next));
        });
    }
  }, [targets, index, context, mode, cache]);

  const target = targets[index] ?? null;
  const loaded = target ? results.get(target.card.id) : undefined;
  // In the deck tool, a card already swapped in is in the deck now, and one swapped out was just taken out, so neither
  // is offered again; nor is one the player passed on for this card in an earlier sitting.
  const offered =
    loaded?.status === "ready" && target
      ? loaded.suggestions.filter(
          (s) =>
            !picked.some((p) => p.replacement.id === s.card.id || p.target.id === s.card.id) &&
            !declinedAtStart.has(`${target.card.id}:${s.card.id}`),
        )
      : [];
  const first = target?.card.id === startAt ? offered.find((s) => s.card.id === preferred) : undefined;
  const candidates = first ? [first, ...offered.filter((s) => s !== first)] : offered;
  const candidate = candidates[candidateIndex] ?? null;

  // The deck tool records a card's replacements the first time this sitting deals them (the rater has votes instead).
  const dealtIds = candidates.map((c) => c.card.id).join(",");
  useEffect(() => {
    if (mode !== "deck" || !target || dealtIds === "" || batches.current.has(target.card.id)) return;
    const ids = dealtIds.split(",").map((id) => Number(id) as CardId);
    batches.current.set(target.card.id, recordShown("swap", ids, context, target.card.id));
  }, [mode, target, dealtIds, context]);

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
    const batch = mode === "deck" ? batches.current.get(target.card.id) : undefined;
    if (batch) recordDecision(batch, candidate.card.id, value === 1, context, candidate.score);

    if (mode === "rater") {
      if (candidateIndex + 1 >= candidates.length) nextTarget();
      else setCandidateIndex(candidateIndex + 1);
    } else if (value === 1) {
      onPick?.({ target: target.card, replacement: candidate.card });
      nextTarget();
    } else {
      onDecline?.(target.card, candidate.card);
      setCandidateIndex(candidateIndex + 1);
    }
  }

  return {
    target,
    /** undefined while the replacements are loading. */
    loaded,
    emptyReason: loaded?.status === "ready" && loaded.suggestions.length === 0 ? loaded.emptyReason ?? null : null,
    candidate,
    candidateIndex,
    candidateCount: candidates.length,
    targetIndex: index,
    targetCount: targets.length,
    voteError,
    swapIn: () => vote(1),
    pass: () => vote(-1),
    /** Moves on to the next card without a vote: keeps the card in the deck tool, skips it in the rater. */
    keep: () => {
      if (mode === "deck" && target) onKeep?.(target.card);
      nextTarget();
    },
  };
}
