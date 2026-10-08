"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AddResult,
  AddSuggestion,
  Bracket,
  CardId,
  CardSummary,
  CutResult,
  CutSuggestion,
  DeckAnalysis,
  DeckInput,
  RecContext,
  ResolvedLine,
} from "@mtg/core/contract";
import {
  bracketMustCuts,
  copiesInDeck,
  deckBeforeSwaps,
  deckKey,
  decklistFor,
  journeyReducer,
  openSlots,
  phaseIndex,
  startJourney,
  withoutCards,
  workingDeck,
  type BracketMustCut,
  type JourneyAction,
  type JourneyPhase,
  type JourneyState,
} from "@mtg/core/journey";
import { isFrontLand, type DeckEntry } from "@mtg/core/scoring";
import { getApis } from "@/lib/api/client";
import { recordDecision, recordShown, type RecBatch } from "@/lib/rec-events";
import type { Async, ContextChange } from "../use-deck-tool";
import type { Candidates } from "../use-swipe-rater";

/**
 * Cut suggestions asked for when checking a deck against a new bracket: the cut route's cap (MAX_CUT_LIMIT), so every
 * Game Changer in the deck comes back even behind a long list of other must-cuts.
 */
const BRACKET_CHECK_CUT_LIMIT = 40;

/**
 * A bracket change part way through the round made cards must-cuts. The round went back to Cut to show them, with
 * every choice kept, and waits for the player to cut them and go on, or to put the old bracket back.
 */
export interface BracketCheck {
  /** The step the change interrupted, where Revert goes back to. */
  from: JourneyPhase;
  /** The bracket before the change (null: it was estimated), which Revert restores. */
  previousBracket: Bracket | null;
  bracket: Bracket;
  mustCuts: BracketMustCut[];
}

interface Round {
  id: number;
  analysis: DeckAnalysis;
  state: JourneyState;
  check: BracketCheck | null;
}

/** What "Find …" in Deck stats narrowed Add to (T045). */
export type AddFilter = { kind: "role"; roleId: string; label: string } | { kind: "lands" };

/** Whether a card fits the filter: one of its tracked roles, or a land on its front face. */
export const matchesAddFilter = (filter: AddFilter, card: CardSummary) =>
  filter.kind === "lands" ? isFrontLand(card.typeLine) : (card.roles ?? []).includes(filter.roleId);

const sameFilter = (a: AddFilter | null, b: AddFilter | null) =>
  a === b || (a?.kind === "role" && b?.kind === "role" ? a.roleId === b.roleId : a?.kind === "lands" && b?.kind === "lands");

/** The Add suggestions a filter leaves on show, in the order they were dealt. */
const filtered = (suggestions: AddSuggestion[], filter: AddFilter | null) =>
  filter ? suggestions.filter((s) => matchesAddFilter(filter, s.card)) : suggestions;

/** No card ids: the over-bracket set before any add, kept as one value so its readers see a stable reference. */
const NO_IDS: ReadonlySet<CardId> = new Set();

const isLand = (card: CardSummary) => /\bLand\b/.test(card.typeLine.split(" // ")[0] ?? card.typeLine);

/**
 * A list asked for this round, with the key of the deck it was made for: shown again rather than asked for again while
 * that deck is unchanged. A null key means the settings changed since, so the list is asked for again on the way in.
 */
interface ListFor<T> {
  round: number;
  key: string | null;
  value: Async<T>;
}

/**
 * The Swap list, with the replacements fetched for its cards, kept for as long as the list is: a sitting closes when
 * the player leaves the phase, and coming back must not ask the database again for cards it already has. A new list
 * (new deck, new settings, new round) starts empty, since its replacements were asked for under other settings.
 */
interface ReplaceList extends ListFor<CutResult> {
  candidates: Map<CardId, Candidates>;
}

/** A deck's main cards as entries, with the cards the round has seen; cards it hasn't are left out. */
const entriesFor = (deck: DeckInput | null, cards: ReadonlyMap<CardId, CardSummary>): DeckEntry[] =>
  (deck?.cards ?? []).flatMap((c) => {
    const card = c.section === "main" ? cards.get(c.cardId) : undefined;
    return card ? [{ card, quantity: c.quantity }] : [];
  });

const toAsync = <T,>(r: { ok: true; data: T } | { ok: false; error: { message: string } }): Async<T> =>
  r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.error.message };

/**
 * The order Add deals its cards in: best score first, except that a deck a cut left short of lands gets lands first,
 * since ranking by score alone would fill the slot with spells.
 */
function addOrder(suggestions: readonly AddSuggestion[], landsShort: boolean): AddSuggestion[] {
  return [...suggestions].sort(
    (a, b) => Number(landsShort && isLand(b.card)) - Number(landsShort && isLand(a.card)) || b.score.total - a.score.total,
  );
}

/**
 * The deck journey on top of the deck tool: Cut, Add, Replace, Review.
 *
 * The tool's analysis is the round's starting deck. Every choice lives in the journey's state and the recommendations
 * are asked for against the deck as it stands (`workingDeck`), so nothing is re-parsed until the player commits the
 * result. A new analysis — a fresh paste, a re-analyze, a start over — starts a new round; the tool says which by
 * `round`. The same deck read again (new play-rate data after a deck lookup) keeps the round and the player's choices.
 *
 * Requests fire from event handlers, like the tool's, and a counter per request drops responses a newer one overtook.
 * When the settings the lists were made with change (bracket, collection, play rates), the tool calls `reload`.
 */
export function useDeckJourney({
  analysis,
  round: roundId,
  context,
  lines,
  cut,
}: {
  analysis: DeckAnalysis | null;
  /** The tool's analysis count: a new value is a new deck, and a new round. */
  round: number;
  context: RecContext | null;
  lines: readonly ResolvedLine[];
  /** The tool's cut suggestions for the round's starting deck: the Cut phase deals the mandatory ones. */
  cut: Async<CutResult>;
}) {
  const [round, setRound] = useState<Round | null>(null);
  // Each list remembers the round it was asked for, so a round's lists never show in the next one.
  const [addFor, setAdd] = useState<ListFor<AddResult> | null>(null);
  const [replaceFor, setReplace] = useState<ReplaceList | null>(null);
  /** Bumped when the Replace targets are asked for again, so the swipe view starts over on the new list. */
  const [replaceVersion, setReplaceVersion] = useState(0);
  const addRequest = useRef(0);
  /**
   * The Add list as recorded for the accept rate (T065), with the filter it was shown under, and the Cut list with the
   * cut result it came from. A filter shows a shorter list, so it is recorded as its own batch: a decision's position is
   * its place in the list the player was looking at.
   */
  const addBatch = useRef<{ batch: RecBatch; filter: AddFilter | null } | null>(null);
  /** An Add list asked for and not yet in: it is recorded on arrival, under the filter on screen then. */
  const addPending = useRef(false);
  const cutBatch = useRef<{ from: CutResult; batch: RecBatch } | null>(null);
  const replaceRequest = useRef(0);
  const checkRequest = useRef(0);
  /**
   * Cards added this round whose suggestion would complete a combo above the bracket (T045): Deck stats counts them
   * against the bracket while they are in the deck. Kept with the round it belongs to, so a new round starts empty.
   */
  const [overBracket, setOverBracket] = useState<{ round: number; ids: ReadonlySet<CardId> } | null>(null);

  // A new analysis starts a new round; the same deck read again keeps it, with the new reading (commander data after a
  // lookup). Adjusted during render rather than in an effect, so no frame shows the old round.
  let current = round;
  if (analysis && round?.id !== roundId) {
    current = { id: roundId, analysis, state: startJourney(analysis.deck), check: null };
    setRound(current);
  } else if (analysis && round && round.analysis !== analysis) {
    current = { ...round, analysis };
    setRound(current);
  } else if (!analysis && round) {
    current = null;
    setRound(null);
  }
  /** The round as of the latest render, for code that resumes after a request. */
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });
  const state = current?.state ?? null;
  const idle: Async<never> = { status: "idle" };
  const add = current && addFor?.round === current.id ? addFor.value : idle;
  const replace = current && replaceFor?.round === current.id ? replaceFor.value : idle;

  const overBracketIds = current && overBracket?.round === current.id ? overBracket.ids : NO_IDS;

  /** What a "Find …" action in Deck stats narrowed Add to. It lasts while Add is on screen: leaving the step, or a new round, clears it. */
  const [addFilterSet, setAddFilterSet] = useState<AddFilter | null>(null);
  if (addFilterSet !== null && state?.phase !== "add") setAddFilterSet(null);
  const addFilter = state?.phase === "add" ? addFilterSet : null;
  /** The filter as of the latest render, for an Add list that arrives after it. */
  const addFilterRef = useRef(addFilter);
  useEffect(() => {
    addFilterRef.current = addFilter;
  });

  // Every card the round has seen, for names and images of cards that are not in the pasted list. Kept between renders
  // while its inputs stand, so what is built on it (the deck as entries, which Deck stats re-tallies) keeps too.
  const cards = useMemo(() => {
    const seen = new Map<CardId, CardSummary>();
    for (const { resolution } of lines) if (resolution.status === "resolved") seen.set(resolution.card.id, resolution.card);
    for (const c of analysis?.commanderKey.commanders ?? []) seen.set(c.id, c);
    if (state) {
      for (const c of [...state.cuts, ...state.adds, ...state.swaps.flatMap((s) => [s.target, s.replacement])]) seen.set(c.id, c);
    }
    return seen;
  }, [lines, analysis, state]);

  const deck = useMemo(() => (state ? workingDeck(state) : null), [state]);
  const workingContext = context && deck ? { ...context, deck } : null;

  const entriesOf = (d: typeof deck): DeckEntry[] => entriesFor(d, cards);
  /** Copies of lands in a deck. */
  const lands = (d: typeof deck) => entriesOf(d).filter((e) => isLand(e.card)).reduce((n, e) => n + e.quantity, 0);
  const commanders = useMemo(
    () =>
      (analysis?.deck.commanders ?? []).flatMap((id) => {
        const card = cards.get(id);
        return card ? [{ card, quantity: 1 }] : [];
      }),
    [analysis, cards],
  );
  /** The deck as it stands, as entries, commanders first: one value per change, since Deck stats re-tallies on a new one. */
  const after = useMemo(() => [...commanders, ...entriesFor(deck, cards)], [commanders, deck, cards]);
  /** The round's starting deck the same way: Deck stats draws its round-start ticks from it. */
  const before = useMemo(() => [...commanders, ...entriesFor(analysis?.deck ?? null, cards)], [commanders, analysis, cards]);

  /** Cards to add for the deck as `next` leaves it, leaving out the ones the player passed on this round. */
  async function loadAdds(next: JourneyState, ctx: RecContext | null = context): Promise<void> {
    if (!ctx || !current) return;
    const round = current.id;
    const id = ++addRequest.current;
    const deck = workingDeck(next);
    const key = deckKey(deck);
    setAdd({ round, key, value: { status: "loading" } });
    addPending.current = true;
    const r = await getApis().recs.add({ context: { ...ctx, deck }, excludeCardIds: next.declinedAdds });
    if (id !== addRequest.current) return;
    addPending.current = false;
    setAdd({ round, key, value: toAsync(r) });
    if (r.ok) {
      // Recorded in the order the player sees it, filter applied, so an accept's position is the place it was dealt from.
      const shortOfLands = analysis ? lands(deck) < lands(analysis.deck) : false;
      const filter = addFilterRef.current;
      const shown = filtered(addOrder(r.data.groups.flatMap((g) => g.suggestions), shortOfLands), filter).map((s) => s.card.id);
      addBatch.current = { batch: recordShown("add", shown, { ...ctx, deck }), filter };
    }
  }

  /**
   * Weaker fits in the deck as `next` leaves it before any swap (`deckBeforeSwaps`), so the list is the same however
   * many swaps are picked from it. Cards swapped earlier in the round that the list no longer names lead it, so every
   * swap stays on the list with its replacement marked. Kept cards stay too: the sitting steps over decided cards as
   * their turn comes, since it deals the list by position and a card vanishing from it would skip the one after it.
   */
  async function loadReplaceTargets(next: JourneyState, ctx: RecContext | null = context): Promise<void> {
    if (!ctx || !current) return;
    const round = current.id;
    const id = ++replaceRequest.current;
    const deck = deckBeforeSwaps(next);
    const key = deckKey(deck);
    const candidates = new Map<CardId, Candidates>();
    setReplace({ round, key, candidates, value: { status: "loading" } });
    setReplaceVersion((v) => v + 1);
    const r = await getApis().recs.cut({ context: { ...ctx, deck } });
    if (id !== replaceRequest.current) return;
    if (!r.ok) {
      setReplace({ round, key, candidates, value: toAsync(r) });
      return;
    }
    // Additions were chosen just now, so they aren't dealt as weaker fits.
    const added = new Set<number>(next.adds.map((c) => c.id));
    const listed = r.data.suggestions.filter((s) => !added.has(s.card.id));
    const named = new Set<number>(listed.map((s) => s.card.id));
    const swapped = next.swaps
      .filter((s) => !named.has(s.target.id))
      .map((s): CutSuggestion => ({ card: s.target, cutScore: 0, reasons: [], severity: "suggested", corpus: null, owned: null }));
    setReplace({ round, key, candidates, value: { status: "ready", data: { ...r.data, suggestions: [...swapped, ...listed] } } });
  }

  /** Whether the Add list on hand was made for the deck as `s` leaves it (or is on its way). */
  const addFresh = (s: JourneyState) =>
    current !== null && addFor?.round === current.id && addFor.key === deckKey(workingDeck(s)) && addFor.value.status !== "error";
  /** Whether the Swap list on hand was made for the deck as `s` leaves it before swaps (or is on its way). */
  const replaceFresh = (s: JourneyState) =>
    current !== null &&
    replaceFor?.round === current.id &&
    replaceFor.key === deckKey(deckBeforeSwaps(s)) &&
    replaceFor.value.status !== "error";

  /** The settings changed: every list on hand was made with the old ones, so each is asked for again on the way in. */
  function invalidateLists() {
    setAdd((prev) => prev && { ...prev, key: null });
    setReplace((prev) => prev && { ...prev, key: null });
  }

  /**
   * The settings suggestions are made with changed (bracket, collection, play rates): asks again for the list on
   * screen, with the context given rather than this render's, which may predate the change. Resolves once it is in.
   *
   * A bracket change past the Cut step first checks the deck as it stands against the new bracket. When that makes
   * cards must-cuts, the round goes back to Cut to show them (see BracketCheck) and the list is left as it was, so
   * Revert finds it unchanged. A second change while that is on screen checks again from the same starting point.
   */
  async function reload(ctx: RecContext, change: ContextChange): Promise<void> {
    const now = latest.current;
    if (!now) return;
    const pending = now.check;
    const phase = pending?.from ?? now.state.phase;
    if (change.kind === "bracket" && phase !== "cut") {
      const previousBracket = pending ? pending.previousBracket : change.previous;
      const roundAt = now.id;
      const id = ++checkRequest.current;
      const r = await getApis().recs.cut({ context: { ...ctx, deck: workingDeck(now.state) }, limit: BRACKET_CHECK_CUT_LIMIT });
      if (id !== checkRequest.current || latest.current?.id !== roundAt) return;
      // A failed check leaves the round where it is: the list reload below reports the failure where the player looks.
      const mustCuts = r.ok ? bracketMustCuts(r.data.suggestions, ctx.bracket) : [];
      if (mustCuts.length > 0) {
        const check: BracketCheck = { from: phase, previousBracket, bracket: ctx.bracket, mustCuts };
        setRound((prev) =>
          prev?.id === roundAt ? { ...prev, check, state: journeyReducer(prev.state, { type: "goto", phase: "cut" }) } : prev,
        );
        return;
      }
      if (pending) {
        setRound((prev) =>
          prev?.id === roundAt ? { ...prev, check: null, state: journeyReducer(prev.state, { type: "goto", phase }) } : prev,
        );
      }
    }
    invalidateLists();
    const choices = latest.current?.state ?? now.state;
    if (phase === "add" && openSlots(choices) > 0) return loadAdds(choices, ctx);
    if (phase === "replace") return loadReplaceTargets(choices, ctx);
  }

  /**
   * Cut & Continue: takes the bracket's must-cuts out of the deck as it stands (wherever each came from, see
   * removeFromDeck) and goes on to the next step, asking for its list at the new bracket: Add when that opened slots.
   */
  function cutAndContinue() {
    if (!current?.check) return;
    checkRequest.current++;
    const cut = withoutCards(current.state, current.check.mustCuts.map((m) => m.card));
    const phase: JourneyPhase = openSlots(cut) > 0 ? "add" : "replace";
    const next = journeyReducer(cut, { type: "goto", phase });
    setRound({ ...current, check: null, state: next });
    if (phase === "add") void loadAdds(next);
    else void loadReplaceTargets(next);
  }

  /**
   * Revert: back to the step the bracket change interrupted, with every choice and its list as they were. Returns the
   * bracket to put back (undefined when there was no check), which is the tool's to restore.
   */
  function revertCheck(): Bracket | null | undefined {
    if (!current?.check) return undefined;
    checkRequest.current++;
    const { from, previousBracket } = current.check;
    setRound({ ...current, check: null, state: journeyReducer(current.state, { type: "goto", phase: from }) });
    return previousBracket;
  }

  /**
   * Applies choices and returns the state they lead to, so a request can go out for it in the same handler. Builds on
   * the latest round rather than this render's: one handler can apply twice (the sitting's last swap, then going on to
   * Review), and the second must not undo the first.
   */
  function apply(...actions: JourneyAction[]): JourneyState | null {
    const from = latest.current ?? current;
    if (!from) return null;
    const next = actions.reduce(journeyReducer, from.state);
    const round = { ...from, state: next };
    latest.current = round;
    setRound(round);
    return next;
  }

  function goTo(phase: JourneyPhase, ...before: JourneyAction[]) {
    // Choosing the step already on screen changes nothing, and must not throw away the list the player is part way through.
    if (before.length === 0 && state?.phase === phase) return;
    const leaving = state?.phase;
    const next = apply(...before, { type: "goto", phase });
    if (!next) return;
    if (leaving === "cut" && phase !== "cut") recordCuts(next);
    // The Add and Replace lists depend on everything chosen before them, so they are asked for on the way in, unless
    // the one on hand was made for the same deck: then the player picks up where they left off. A full deck has
    // nothing to add, so Add asks for nothing.
    if (phase === "add" && openSlots(next) > 0 && !addFresh(next)) void loadAdds(next);
    if (phase === "replace" && !replaceFresh(next)) void loadReplaceTargets(next);
  }

  // ── Cut ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const recommendedCuts: CutSuggestion[] =
    cut.status === "ready" ? cut.data.suggestions.filter((s) => s.severity === "mandatory") : [];
  const isCut = (id: CardId) => state?.cuts.some((c) => c.id === id) ?? false;
  const isKept = (id: CardId) => state?.kept.includes(id) ?? false;
  /** Recommended cuts not yet decided either way: dealt in the swipe view, pre-marked in the list. */
  const undecidedCuts = recommendedCuts.filter((s) => !isCut(s.card.id) && !isKept(s.card.id));
  const recommendedIds = new Set(recommendedCuts.map((s) => s.card.id as number));

  /**
   * The accept rate (T065): leaving Cut records the recommended cuts as shown, once per cut list, and each one cut or
   * kept as the player left it. A decision changed on a later visit replaces the earlier one.
   */
  function recordCuts(next: JourneyState) {
    if (cut.status !== "ready" || !context || recommendedCuts.length === 0) return;
    if (cutBatch.current?.from !== cut.data) {
      cutBatch.current = { from: cut.data, batch: recordShown("cut", recommendedCuts.map((s) => s.card.id), context) };
    }
    const { batch } = cutBatch.current;
    for (const s of recommendedCuts) {
      const isCutNow = next.cuts.some((c) => c.id === s.card.id);
      if (isCutNow || next.kept.includes(s.card.id)) recordDecision(batch, s.card.id, isCutNow, context);
    }
  }

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
  const landsShort = analysis && deck ? lands(deck) < lands(analysis.deck) : false;
  const addQueue: AddSuggestion[] =
    add.status === "ready" && state
      ? addOrder(
          add.data.groups
            .flatMap((g) => g.suggestions)
            .filter((s) => !state.declinedAdds.includes(s.card.id) && !state.adds.some((a) => a.id === s.card.id)),
          landsShort,
        )
      : [];

  /**
   * Records the Add list on hand as shown under `filter`, unless it already was. Called when a filter is applied or
   * cleared, and before a decision, in case the filter changed some other way (leaving Add clears it).
   */
  function recordAddList(filter: AddFilter | null) {
    const ctx = workingContext ?? context;
    if (!ctx || add.status !== "ready" || addPending.current) return;
    if (addBatch.current && sameFilter(addBatch.current.filter, filter)) return;
    addBatch.current = { batch: recordShown("add", filtered(addQueue, filter).map((s) => s.card.id), ctx), filter };
  }

  /**
   * Narrows Add to a role or to lands, or (null) shows it all again. Called after the step opens: a list on its way is
   * recorded under the filter when it arrives, and the list on hand is recorded again now, as the player sees it.
   */
  function setAddFilter(filter: AddFilter | null) {
    addFilterRef.current = filter;
    setAddFilterSet(filter);
    if (latest.current?.state.phase === "add") recordAddList(filter);
  }

  /** A card from the Add list taken or passed on, for the accept rate (T065). */
  function recordAddDecision(card: CardSummary, accepted: boolean) {
    const ctx = workingContext ?? context;
    if (!ctx) return;
    recordAddList(addFilter);
    if (!addBatch.current) return;
    recordDecision(addBatch.current.batch, card.id, accepted, ctx, addQueue.find((s) => s.card.id === card.id)?.score);
  }

  /** Adding recomputes the list: the new card may fill the gap the next ones were suggested for. */
  function acceptAdd(card: CardSummary) {
    recordAddDecision(card, true);
    // An add that completes a combo above the bracket counts against it while it stays (Deck stats checks the deck).
    const roundId = current?.id;
    if (roundId !== undefined && addQueue.find((s) => s.card.id === card.id)?.completesOverBracket?.length) {
      setOverBracket((prev) => ({ round: roundId, ids: new Set([...(prev?.round === roundId ? prev.ids : []), card.id]) }));
    }
    const next = apply({ type: "add", card });
    if (next && openSlots(next) > 0) void loadAdds(next);
  }

  /**
   * Passing only moves on: nothing about the deck changed. Once every suggestion on hand has been passed on, the list
   * is asked for again without them, so the next best cards come up instead of an empty queue.
   */
  function passAdd(card: CardSummary) {
    recordAddDecision(card, false);
    const next = apply({ type: "declineAdd", cardId: card.id });
    if (next && openSlots(next) > 0 && addQueue.every((s) => s.card.id === card.id)) void loadAdds(next);
  }

  function undoAdd(card: CardSummary) {
    const next = apply({ type: "unadd", cardId: card.id });
    if (next) void loadAdds(next);
  }

  // ── Stepper ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The current step's Next: what its own button does. */
  function nextStep() {
    if (!state) return;
    if (state.phase === "cut") finishCuts();
    else if (state.phase === "add") goTo("replace");
    else if (state.phase === "replace") goTo("review");
  }

  /**
   * Whether the stepper may open a step. Earlier steps always; the next one, as its Next; one further on only when
   * the round has been there and the deck is unchanged since its Swap list was made, so going back to look changes
   * nothing. A bracket check waiting in Cut keeps the way on to its own buttons.
   */
  function canOpen(phase: JourneyPhase): boolean {
    if (!state) return false;
    const at = phaseIndex(state.phase);
    const to = phaseIndex(phase);
    if (to <= at) return true;
    if (current?.check) return false;
    if (to === at + 1) return true;
    if (to > phaseIndex(state.reached)) return false;
    return replaceFresh(state.phase === "cut" ? pendingCuts.reduce(journeyReducer, state) : state);
  }

  /** A step chosen in the stepper: the next step is the current one's Next; another goes there directly. */
  function select(phase: JourneyPhase) {
    if (!state || !canOpen(phase)) return;
    const at = phaseIndex(state.phase);
    const to = phaseIndex(phase);
    if (to === at + 1) nextStep();
    else goTo(phase, ...(state.phase === "cut" && to > at ? pendingCuts : []));
  }

  // ── Replace ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Weaker fits in the deck as it now stands, each dealt with a replacement (kept ones left out when they load). */
  const replaceTargets: CutSuggestion[] =
    replace.status === "ready" ? replace.data.suggestions.filter((s) => s.severity === "suggested") : [];

  // ── Result ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The decklist the round ends with, for committing (save, re-analyze). */
  function resultText(): string | null {
    return deck ? decklistFor(deck, (id) => cards.get(id)?.name ?? null) : null;
  }

  return {
    state,
    dispatch: (action: JourneyAction) => void apply(action),
    goTo,
    stepper: { canOpen, select },
    deck,
    workingContext,
    cards,
    /** The round's starting deck and the deck as it stands, as entries, commanders first. */
    before,
    after,
    /** Cards added this round that complete a combo above the bracket; Deck stats counts the ones still in the deck. */
    overBracketIds,
    openSlots: state ? openSlots(state) : 0,
    cut: { recommended: recommendedCuts, undecided: undecidedCuts, slotsAfter: slotsAfterCuts, isMarked: isMarkedForCut, toggle: toggleCut, finish: finishCuts },
    add: {
      state: add,
      queue: addQueue,
      /** The queue as dealt: narrowed to the filter when one is set. */
      shown: filtered(addQueue, addFilter),
      filter: addFilter,
      setFilter: setAddFilter,
      landsShort,
      accept: acceptAdd,
      pass: passAdd,
      undo: undoAdd,
    },
    replace: {
      state: replace,
      targets: replaceTargets,
      /** Keeps a card the Replace phase dealt, so coming back to the phase doesn't deal it again. */
      keep: (cardId: CardId) => void apply({ type: "keepInReplace", cardId }),
      /** Changes each time the targets are asked for again. */
      version: replaceVersion,
      /** Replacements already fetched for this list, by card, for every sitting over it. */
      candidates: current && replaceFor?.round === current.id ? replaceFor.candidates : undefined,
      /** Whether a card is still in the deck: a target swapped out, or one an undone addition took out, is decided. */
      inDeck: (cardId: CardId) => (state ? copiesInDeck(state, cardId) > 0 : false),
      /** Whether the player kept a card the Replace phase dealt. */
      isKept: (cardId: CardId) => state?.keptInReplace.includes(cardId) ?? false,
      /** The swap picked for a card, if any. */
      swapFor: (cardId: CardId) => state?.swaps.find((s) => s.target.id === cardId) ?? null,
      /** Replacements passed on this round, which aren't offered for that card again. */
      declined: state?.declinedSwaps ?? [],
      decline: (targetId: CardId, replacementId: CardId) => void apply({ type: "declineSwap", targetId, replacementId }),
    },
    /** A bracket change that made cards must-cuts, waiting for Cut & Continue or Revert. */
    bracketCheck: current?.check ?? null,
    cutAndContinue,
    revertCheck,
    reload,
    resultText,
  };
}

export type DeckJourney = ReturnType<typeof useDeckJourney>;
