"use client";

import { useRef, useState } from "react";
import type { AddResult, AddSuggestion, CardId, CardSummary, CutResult, CutSuggestion, DeckAnalysis, RecContext, ResolvedLine } from "@mtg/core/contract";
import {
  decklistFor,
  journeyReducer,
  openSlots,
  startJourney,
  workingDeck,
  type JourneyAction,
  type JourneyPhase,
  type JourneyState,
} from "@mtg/core/journey";
import type { DeckEntry } from "@mtg/core/scoring";
import { getApis } from "@/lib/api/client";
import type { Async } from "../use-deck-tool";

const isLand = (card: CardSummary) => /\bLand\b/.test(card.typeLine.split(" // ")[0] ?? card.typeLine);

const toAsync = <T,>(r: { ok: true; data: T } | { ok: false; error: { message: string } }): Async<T> =>
  r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.error.message };

/**
 * The deck journey on top of the deck tool: Cut, Add, Replace, Review.
 *
 * The tool's analysis is the round's starting deck. Every choice lives in the journey's state and the recommendations
 * are asked for against the deck as it stands (`workingDeck`), so nothing is re-parsed until the player commits the
 * result. A new analysis — a fresh paste, a re-analyze, a start over — starts a new round.
 *
 * Requests fire from event handlers, like the tool's, and a counter per request drops responses a newer one overtook.
 */
export function useDeckJourney({
  analysis,
  context,
  lines,
  cut,
}: {
  analysis: DeckAnalysis | null;
  context: RecContext | null;
  lines: readonly ResolvedLine[];
  /** The tool's cut suggestions for the round's starting deck: the Cut phase deals the mandatory ones. */
  cut: Async<CutResult>;
}) {
  const [round, setRound] = useState<{ analysis: DeckAnalysis; state: JourneyState } | null>(null);
  // Each list remembers the round it was asked for, so a round's lists never show in the next one.
  const [addFor, setAdd] = useState<{ round: DeckAnalysis; value: Async<AddResult> } | null>(null);
  const [replaceFor, setReplace] = useState<{ round: DeckAnalysis; value: Async<CutResult> } | null>(null);
  const addRequest = useRef(0);
  const replaceRequest = useRef(0);

  // A new analysis starts a new round. Adjusted during render rather than in an effect, so no frame shows the old round.
  let current = round;
  if (analysis && round?.analysis !== analysis) {
    current = { analysis, state: startJourney(analysis.deck) };
    setRound(current);
  } else if (!analysis && round) {
    current = null;
    setRound(null);
  }
  const state = current?.state ?? null;
  const idle: Async<never> = { status: "idle" };
  const add = current && addFor?.round === current.analysis ? addFor.value : idle;
  const replace = current && replaceFor?.round === current.analysis ? replaceFor.value : idle;

  // Every card the round has seen, for names and images of cards that are not in the pasted list.
  const cards = new Map<CardId, CardSummary>();
  for (const { resolution } of lines) if (resolution.status === "resolved") cards.set(resolution.card.id, resolution.card);
  for (const c of analysis?.commanderKey.commanders ?? []) cards.set(c.id, c);
  if (state) {
    for (const c of [...state.cuts, ...state.adds, ...state.swaps.flatMap((s) => [s.target, s.replacement])]) cards.set(c.id, c);
  }

  const deck = state ? workingDeck(state) : null;
  const workingContext = context && deck ? { ...context, deck } : null;

  const entriesOf = (d: typeof deck): DeckEntry[] =>
    (d?.cards ?? []).flatMap((c) => {
      const card = c.section === "main" ? cards.get(c.cardId) : undefined;
      return card ? [{ card, quantity: c.quantity }] : [];
    });
  const commanders = (analysis?.deck.commanders ?? []).flatMap((id) => {
    const card = cards.get(id);
    return card ? [{ card, quantity: 1 }] : [];
  });

  function loadAdds(next: JourneyState) {
    if (!context || !current) return;
    const round = current.analysis;
    const id = ++addRequest.current;
    setAdd({ round, value: { status: "loading" } });
    void getApis()
      .recs.add({ context: { ...context, deck: workingDeck(next) } })
      .then((r) => {
        if (id === addRequest.current) setAdd({ round, value: toAsync(r) });
      });
  }

  function loadReplaceTargets(next: JourneyState) {
    if (!context || !current) return;
    const round = current.analysis;
    const id = ++replaceRequest.current;
    setReplace({ round, value: { status: "loading" } });
    void getApis()
      .recs.cut({ context: { ...context, deck: workingDeck(next) } })
      .then((r) => {
        if (id === replaceRequest.current) setReplace({ round, value: toAsync(r) });
      });
  }

  /** Applies choices and returns the state they lead to, so a request can go out for it in the same handler. */
  function apply(...actions: JourneyAction[]): JourneyState | null {
    if (!current) return null;
    const next = actions.reduce(journeyReducer, current.state);
    const analysisNow = current.analysis;
    setRound({ analysis: analysisNow, state: next });
    return next;
  }

  function goTo(phase: JourneyPhase, ...before: JourneyAction[]) {
    const next = apply(...before, { type: "goto", phase });
    if (!next) return;
    // The Add and Replace lists depend on everything chosen before them, so they are asked for on the way in.
    if (phase === "add") loadAdds(next);
    if (phase === "replace") loadReplaceTargets(next);
  }

  // ── Cut ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const recommendedCuts: CutSuggestion[] =
    cut.status === "ready" ? cut.data.suggestions.filter((s) => s.severity === "mandatory") : [];
  const isCut = (id: CardId) => state?.cuts.some((c) => c.id === id) ?? false;
  const isKept = (id: CardId) => state?.kept.includes(id) ?? false;
  /** Recommended cuts not yet decided either way: dealt in the swipe view, pre-marked in the list. */
  const undecidedCuts = recommendedCuts.filter((s) => !isCut(s.card.id) && !isKept(s.card.id));
  const recommendedIds = new Set(recommendedCuts.map((s) => s.card.id as number));

  /** List view: a card is marked when it is cut, or recommended and not kept. */
  const isMarkedForCut = (card: CardSummary) => isCut(card.id) || (recommendedIds.has(card.id) && !isKept(card.id));

  function toggleCut(card: CardSummary) {
    if (!state) return;
    if (!isMarkedForCut(card)) {
      apply({ type: "cut", card });
      return;
    }
    const copies = state.cuts.filter((c) => c.id === card.id).length;
    const uncuts: JourneyAction[] = Array.from({ length: copies }, () => ({ type: "uncut", cardId: card.id }));
    // Unmarking a recommended card is a decision to keep it; unmarking one the player picked just takes it back.
    apply(...uncuts, ...(recommendedIds.has(card.id) ? [{ type: "keep", cardId: card.id } as const] : []));
  }

  const pendingCuts = undecidedCuts.map((s): JourneyAction => ({ type: "cut", card: s.card }));
  /** The room Add will have once the marked cuts go: what the Cut phase's Next promises. */
  const slotsAfterCuts = current ? openSlots(pendingCuts.reduce(journeyReducer, current.state)) : 0;

  /**
   * On to Add. Recommended cuts nobody decided on go as marked, which is what "accept the cuts as is" means. With no
   * room to fill, the journey goes straight on to Replace.
   */
  function finishCuts() {
    goTo(slotsAfterCuts > 0 ? "add" : "replace", ...pendingCuts);
  }

  // ── Add ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const lands = (d: typeof deck) => entriesOf(d).filter((e) => isLand(e.card)).reduce((n, e) => n + e.quantity, 0);
  // Cutting a land leaves the mana base short, and ranking by score alone would fill the slot with spells.
  const landsShort = analysis && deck ? lands(deck) < lands(analysis.deck) : false;
  const addQueue: AddSuggestion[] =
    add.status === "ready" && state
      ? add.data.groups
          .flatMap((g) => g.suggestions)
          .filter((s) => !state.declinedAdds.includes(s.card.id) && !state.adds.some((a) => a.id === s.card.id))
          .sort((a, b) => Number(landsShort && isLand(b.card)) - Number(landsShort && isLand(a.card)) || b.score.total - a.score.total)
      : [];

  /** Adding recomputes the list: the new card may fill the gap the next ones were suggested for. */
  function acceptAdd(card: CardSummary) {
    const next = apply({ type: "add", card });
    if (next && openSlots(next) > 0) loadAdds(next);
  }

  /** Passing only moves on: nothing about the deck changed. */
  function passAdd(card: CardSummary) {
    apply({ type: "declineAdd", cardId: card.id });
  }

  function undoAdd(card: CardSummary) {
    const next = apply({ type: "unadd", cardId: card.id });
    if (next) loadAdds(next);
  }

  // ── Replace ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Weaker fits in the deck as it now stands, each dealt with a replacement. */
  const replaceTargets: CutSuggestion[] =
    replace.status === "ready" && state
      ? replace.data.suggestions.filter((s) => s.severity === "suggested" && !state.keptInReplace.includes(s.card.id))
      : [];

  // ── Result ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The decklist the round ends with, for committing (save, re-analyze). */
  function resultText(): string | null {
    return deck ? decklistFor(deck, (id) => cards.get(id)?.name ?? null) : null;
  }

  return {
    state,
    dispatch: (action: JourneyAction) => void apply(action),
    goTo,
    deck,
    workingContext,
    cards,
    /** The round's starting deck and the deck as it stands, as entries, commanders first. */
    before: [...commanders, ...entriesOf(analysis?.deck ?? null)],
    after: [...commanders, ...entriesOf(deck)],
    openSlots: state ? openSlots(state) : 0,
    cut: { recommended: recommendedCuts, undecided: undecidedCuts, slotsAfter: slotsAfterCuts, isMarked: isMarkedForCut, toggle: toggleCut, finish: finishCuts },
    add: { state: add, queue: addQueue, landsShort, accept: acceptAdd, pass: passAdd, undo: undoAdd },
    replace: { state: replace, targets: replaceTargets },
    resultText,
  };
}

export type DeckJourney = ReturnType<typeof useDeckJourney>;
