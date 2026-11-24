"use client";

import { useEffect, useRef, useState } from "react";
import type { CardId, CardSummary, CommanderKeyId, CorpusEvidence, CutReason, RecContext, SwapResult, SwapSuggestion } from "@mtg/core/contract";
import { isBasicLand } from "@mtg/core/journey";
import { effectiveCapUsd, withinBudget } from "@mtg/core/scoring";
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
  /** Its play data with this commander, for comparing a replacement's play rate with it. */
  corpus?: CorpusEvidence | null;
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
  declined = [],
  skipTarget,
  startAt,
  preferred,
  cache,
  skipEmpty = mode === "rater",
  onFinish,
  onNothingDealt,
}: {
  targets: readonly RaterTarget[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  mode?: SwipeMode | undefined;
  picked?: readonly PickedSwap[] | undefined;
  /**
   * Deck tool: the player swapped a replacement in. `passedOver` names the options seen for that card before it was
   * picked, which count as passed on (once per sitting), so the host can stop offering them in one step with the swap.
   */
  onPick?: ((swap: PickedSwap, passedOver: readonly CardId[]) => void) | undefined;
  onVote?: ((vote: SwipeVote) => void) | undefined;
  /** Deck tool: the player kept the card rather than swap it, so its host can remember the choice. */
  onKeep?: ((card: CardSummary) => void) | undefined;
  /**
   * Deck tool: replacements already passed on, by card. Read once, when the sitting opens, so options passed over by a
   * swap in this sitting stay where they are if the card comes up again.
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
  /**
   * Step over a card whose replacements came back empty. The rater always does (nothing to rate); the deck tool's
   * swipe sitting asks for it (T088), its list view doesn't: a tapped card says why it has none.
   */
  skipEmpty?: boolean | undefined;
  onFinish: () => void;
  /**
   * The sitting ran out of cards without ever dealing a replacement (every card was stepped over). Called in place of
   * `onFinish` when given, so the host can say so rather than move on.
   */
  onNothingDealt?: (() => void) | undefined;
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
  /** Deck tool: the replacements passed on in this sitting, by "target:replacement", so each is recorded once. */
  const passed = useRef(new Set<string>());
  /**
   * Deck tool: the options put on screen for each card in this sitting, with where they stood. Browsing passes on
   * nothing; a swap passes on the ones seen before it (owner, 2026-11-24).
   */
  const seen = useRef(new Map<CardId, Map<CardId, { suggestion: SwapSuggestion; position: number }>>());
  /** Whether this sitting has put a replacement in front of the player. */
  const dealt = useRef(false);

  // Cards to step over come off the list as their turn comes, rather than out of it: the list is dealt by position.
  // A sitting that skips empties also passes over cards that turn out to have no replacements: there's nothing to
  // rate, or to swap in.
  const skipped = (i: number) => {
    const card = targets[i]!.card;
    if (skipTarget?.(card)) return true;
    if (!skipEmpty) return false;
    const r = results.get(card.id);
    return r?.status === "ready" && r.suggestions.length === 0;
  };
  let index = targetIndex;
  while (index < targets.length && skipped(index)) index++;
  const allSkipped = targets.length > 0 && index >= targets.length;

  // Deck tool: the cards a browse lands on, either side of the one on screen, past the ones to step over.
  let nextIndex: number | null = null;
  for (let i = index + 1; i < targets.length; i++) {
    if (skipped(i)) continue;
    nextIndex = i;
    break;
  }
  let previousIndex: number | null = null;
  for (let i = Math.min(index, targets.length) - 1; i >= 0; i--) {
    if (skipped(i)) continue;
    previousIndex = i;
    break;
  }
  // A sitting that skips empties only browses onto a card whose replacements are in: one that came back empty would be
  // stepped past, and at the end of the list that would finish the sitting.
  const browsable = (i: number | null) => i !== null && (!skipEmpty || results.has(targets[i]!.card.id));

  useEffect(() => {
    if (!allSkipped) return;
    if (!dealt.current && onNothingDealt) onNothingDealt();
    else onFinish();
  }, [allSkipped, onFinish, onNothingDealt]);

  // The card on screen, the next ones, and the one a browse back lands on, past the cards to step over.
  const ahead: CardId[] = [];
  for (let i = index; i < targets.length && ahead.length < PRELOAD; i++) if (!skipped(i)) ahead.push(targets[i]!.card.id);
  if (mode === "deck" && previousIndex !== null) ahead.push(targets[previousIndex]!.card.id);
  const aheadKey = ahead.join(",");
  useEffect(() => {
    if (aheadKey === "") return;
    for (const id of aheadKey.split(",").map((s) => Number(s) as CardId)) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void getApis()
        .recs.swap({ context, targetCardId: id })
        .then((r) => {
          const next: Candidates = r.ok
            ? { status: "ready", suggestions: mode === "rater" ? shuffled(r.data.suggestions.slice(0, RATER_CANDIDATES)) : r.data.suggestions, emptyReason: r.data.emptyReason }
            : { status: "error", message: r.error.message };
          // A failure isn't kept: the next sitting asks again.
          if (next.status === "ready") cache?.set(id, next);
          setResults((prev) => new Map(prev).set(id, next));
        });
    }
  }, [aheadKey, context, mode, cache]);

  const target = targets[index] ?? null;
  const loaded = target ? results.get(target.card.id) : undefined;
  const cap = effectiveCapUsd(context.budget);
  // In the deck tool, a card already swapped in is in the deck now, and one swapped out was just taken out, so neither
  // is offered again; nor is one the player passed on for this card in an earlier sitting.
  const offered =
    loaded?.status === "ready" && target
      ? loaded.suggestions.filter(
          (s) =>
            !picked.some((p) => p.replacement.id === s.card.id || p.target.id === s.card.id) &&
            !declinedAtStart.has(`${target.card.id}:${s.card.id}`) &&
            // A list read earlier in the round may hold cards the money spent since no longer pays for (T091).
            withinBudget(s.card, s.owned !== null, isBasicLand(s.card), cap),
        )
      : [];
  const first = target?.card.id === startAt ? offered.find((s) => s.card.id === preferred) : undefined;
  const candidates = first ? [first, ...offered.filter((s) => s !== first)] : offered;
  const candidate = candidates[candidateIndex] ?? null;
  const dealing = candidate !== null;
  useEffect(() => {
    if (dealing) dealt.current = true;
  }, [dealing]);
  useEffect(() => {
    if (mode !== "deck" || !target || !candidate) return;
    const forTarget = seen.current.get(target.card.id) ?? new Map<CardId, { suggestion: SwapSuggestion; position: number }>();
    if (!forTarget.has(candidate.card.id)) forTarget.set(candidate.card.id, { suggestion: candidate, position: candidateIndex });
    seen.current.set(target.card.id, forTarget);
  }, [mode, target, candidate, candidateIndex]);

  // The deck tool records a card's replacements the first time this sitting deals them (the rater has votes instead).
  const dealtIds = candidates.map((c) => c.card.id).join(",");
  useEffect(() => {
    if (mode !== "deck" || !target || dealtIds === "" || batches.current.has(target.card.id)) return;
    const ids = dealtIds.split(",").map((id) => Number(id) as CardId);
    batches.current.set(target.card.id, recordShown("swap", ids, context, target.card.id));
  }, [mode, target, dealtIds, context]);

  /** After an answer: on to the next card, or the end of the sitting after the last. */
  function advance() {
    setCandidateIndex(0);
    setVoteError(null);
    if (index + 1 >= targets.length) onFinish();
    else setTargetIndex(index + 1);
  }

  /** Deck tool: shows another card to replace, its first option up. Nothing is kept or recorded. */
  function browseTarget(to: number | null) {
    if (to === null || !browsable(to)) return;
    setCandidateIndex(0);
    setVoteError(null);
    setTargetIndex(to);
  }

  /** Deck tool: shows another option for the card on screen. Nothing is passed on or recorded. */
  function browseOption(to: number) {
    if (to < 0 || to >= candidates.length) return;
    setCandidateIndex(to);
    setVoteError(null);
  }

  /** Sends one vote on a replacement for the card on screen, as it stood in the options. */
  function castVote(suggestion: SwapSuggestion, value: 1 | -1, position: number) {
    if (!target) return;
    sessionId.current ??= crypto.randomUUID();
    const matchedTagIds = [...new Set(suggestion.matchedTags.map((m) => m.candidateTag.id))];
    void getApis()
      .actions.castVote({
        targetCardId: target.card.id,
        replacementCardId: suggestion.card.id,
        value,
        ...(commanderKeyId !== null ? { commanderKeyId } : {}),
        context: {
          source: mode === "rater" ? "rater" : "deck",
          sessionId: sessionId.current,
          commanderIds: context.deck.commanders,
          position,
          shownCardIds: candidates.map((c) => c.card.id),
          matchedTagIds,
        },
      })
      .then((r) => {
        if (!r.ok) setVoteError(r.error.message);
      });
  }

  function vote(value: 1 | -1) {
    if (!target || !candidate) return;
    // The deck tool answers an option only by swapping it in: browsing past one passes on nothing.
    if (mode === "deck" && value === -1) return;
    castVote(candidate, value, candidateIndex);
    onVote?.({ target: target.card, replacement: candidate.card, value });
    if (mode === "rater") {
      if (candidateIndex + 1 >= candidates.length) advance();
      else setCandidateIndex(candidateIndex + 1);
      return;
    }

    const batch = batches.current.get(target.card.id);
    if (batch) recordDecision(batch, candidate.card.id, true, context, candidate.score);
    // The options seen before this one was picked were passed over for it, each recorded once a sitting.
    const passedOver: CardId[] = [];
    for (const [id, { suggestion, position }] of seen.current.get(target.card.id) ?? []) {
      const pair = `${target.card.id}:${id}`;
      if (id === candidate.card.id || passed.current.has(pair)) continue;
      passed.current.add(pair);
      castVote(suggestion, -1, position);
      if (batch) recordDecision(batch, id, false, context, suggestion.score);
      passedOver.push(id);
    }
    onPick?.({ target: target.card, replacement: candidate.card }, passedOver);
    advance();
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
    /** The rater's Not a fit. */
    pass: () => vote(-1),
    /** Deck tool: browse the options for the card on screen (the swipe on the card going in, ‹ ›, the arrow keys). */
    nextOption: () => browseOption(candidateIndex + 1),
    back: () => browseOption(candidateIndex - 1),
    canNextOption: candidateIndex + 1 < candidates.length,
    canBackOption: candidateIndex > 0,
    /**
     * Deck tool: browse the cards to replace (the swipe on the card going out). Past the last card there is nothing:
     * only Skip there ends the sitting.
     */
    nextTarget: () => browseTarget(nextIndex),
    previousTarget: () => browseTarget(previousIndex),
    canNextTarget: browsable(nextIndex),
    canPreviousTarget: browsable(previousIndex),
    /** Moves on to the next card without a vote: keeps the card in the deck tool, skips it in the rater. */
    keep: () => {
      if (mode === "deck" && target) onKeep?.(target.card);
      advance();
    },
  };
}
