"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardId, CardSummary, ComboRef, DeckAnalysis, FixCard, FixResult, RecContext, StatChoices } from "@mtg/core/contract";
import {
  BRACKET_LINE,
  CURVE_LINE,
  comboPiecesToKeep,
  deckBeforeFixes,
  deckKey,
  fixBrowser,
  fixLines,
  MAX_FIX_IN_OPTIONS,
  MAX_FIX_OUT_OPTIONS,
  nextPhase,
  planFixes,
  reportWithMoves,
  roundAddedIds,
  toTallyCard,
  workingDeck,
  type BracketInput,
  type DeckStatsReport,
  type FixBrowser,
  type FixInput,
  type FixLine,
  type FixMove,
  type TallyMove,
} from "@mtg/core/journey";
import { preloadCardImages } from "@/components/cards/dealt-card";
import { getApis } from "@/lib/api/client";
import { CARD_IMAGES_AHEAD } from "@/lib/constants";
import type { Async } from "../use-deck-tool";
import type { DeckJourney } from "./use-deck-journey";

/** The lines Fix names that Deck stats has no row for. */
const LEGAL_LINE = "legal";

/** A Deck stats score: lines in line of lines counted. */
export interface StatScore {
  okCount: number;
  total: number;
}

/** A line as Fix's header and Finish name it: its label, and its count against the target where it has one. */
export interface FixLineLabel {
  label: string;
  value?: number;
  target?: number;
}

const NO_ADDS: ReadonlyMap<CardId, readonly ComboRef[]> = new Map();

/** Cards found ahead of the one on screen on each list, after it shows: › and a swipe have the next ones ready. */
const BROWSE_AHEAD = 2;

/** The pair on screen: an index into the browser's cards to take out, and one into that card's cards to put in. */
interface FixCursor {
  browser: FixBrowser | null;
  out: number;
  in: number;
}

/** How long the browser's lists are, once their ends are found: the cards to take out, and each one's cards to put in. */
interface FixLengths {
  browser: FixBrowser | null;
  outs: number | null;
  ins: ReadonlyMap<number, number>;
}

/**
 * A list's length, once the cards found up to `BROWSE_AHEAD` past `at` show its end (a null past the last card, or
 * the cap reached); null while it runs on past them. Finds those cards, which the browser keeps.
 */
function lengthAhead(cardAt: (index: number) => CardSummary | null, at: number, cap: number): number | null {
  for (let index = at + 1; index <= at + BROWSE_AHEAD; index += 1) {
    if (index >= cap) return cap;
    if (cardAt(index) === null) return index;
  }
  return null;
}

/**
 * The cards a browse from (`out`, `in`) deals next, whose images are fetched ahead (T104): the next cards to take out
 * (each with its first card to put in, as › on OUT shows it) and the next cards to put in for this one.
 */
function cardsAhead(browser: FixBrowser, out: number, inIndex: number): (CardSummary | null)[] {
  const cards: (CardSummary | null)[] = [];
  for (let step = 1; step <= CARD_IMAGES_AHEAD; step += 1) {
    if (out + step < MAX_FIX_OUT_OPTIONS && browser.out(out + step)) cards.push(browser.out(out + step), browser.in(out + step, 0));
    if (inIndex + step < MAX_FIX_IN_OPTIONS) cards.push(browser.in(out, inIndex + step));
  }
  return cards;
}

/** The lengths learned with the pair at (`out`, `in`) on screen, kept with the ones learned before for the same browser. */
function learnLengths(known: FixLengths, browser: FixBrowser, out: number, inIndex: number): FixLengths {
  const base = known.browser === browser ? known : { browser, outs: null, ins: new Map<number, number>() };
  const outs = base.outs ?? lengthAhead((o) => browser.out(o), out, MAX_FIX_OUT_OPTIONS);
  const ins = base.ins.get(out) ?? lengthAhead((i) => browser.in(out, i), inIndex, MAX_FIX_IN_OPTIONS);
  if (base === known && outs === known.outs && ins === (known.ins.get(out) ?? null)) return known;
  return { browser, outs, ins: ins === null ? base.ins : new Map(base.ins).set(out, ins) };
}

/** The settings a pool was read with, as one comparable value: a change asks for the pool again. */
function settingsKey(context: RecContext): string {
  const { ownership } = context;
  const collection =
    ownership === null
      ? "none"
      : ownership.kind === "session"
        ? `session:${ownership.catalogEpoch}:${ownership.ownedCardIds.length}`
        : `${ownership.kind}:${ownership.deckId ?? ""}`;
  // The card cap shapes the pool; the spend left doesn't (the engine reads it on every move, T091).
  return [
    context.bracket,
    context.includeGameChangers,
    collection,
    context.ownershipMode ?? "",
    (context.buyFor ?? []).join(","),
    context.budget?.cardCapUsd ?? "",
  ].join("|");
}

/**
 * Fix on top of the journey (T087): reads the pool (`recs.fix`) while the round is on Fix or Finish, and pairs the
 * moves on the deck as it stands (`nextFixMove`, `planFixes`, `fixLines`), so one read serves every move made from it.
 * The pool is read again when the deck changed outside Fix, when the settings change, after an auto-fix is applied,
 * and when Undo steps back past the deck it was read for.
 *
 * A round that reaches Fix with no valid move goes straight on to the next step; a bracket the deck no longer fits
 * brings the round back to Fix, at the bracket line.
 */
export function useFix({
  journey,
  analysis,
  context,
  report,
  choices,
  overBracketAdds = NO_ADDS,
}: {
  journey: DeckJourney;
  analysis: DeckAnalysis | null;
  context: RecContext | null;
  /** Deck stats for the deck as it stands: the lines' labels and counts, and whether the bracket fits. */
  report: DeckStatsReport | null;
  choices: StatChoices;
  overBracketAdds?: ReadonlyMap<CardId, readonly ComboRef[]>;
}) {
  const { state, tally } = journey;
  const phase = state?.phase ?? null;
  const wanted = phase === "fix" || phase === "review";
  /** Bumped to ask for the pool again for the same deck and settings. */
  const [generation, setGeneration] = useState(0);
  const [pool, setPool] = useState<{ key: string; fixes: number; value: Async<FixResult> } | null>(null);
  /** The line Deck stats' or Finish's "Fix" asked for, tried first while Fix is on screen. */
  const [focus, setFocus] = useState<string | null>(null);
  if (focus !== null && phase !== "fix") setFocus(null);

  // New play-rate data for the same deck is a new analysis: the pool's scores were made with the old one.
  const [seenAnalysis, setSeenAnalysis] = useState(analysis);
  if (seenAnalysis !== analysis) {
    setSeenAnalysis(analysis);
    setGeneration(generation + 1);
  }

  const targets = analysis?.statTargets ?? null;
  /** Without targets Deck stats has no lines, so Fix has nothing to bring in line and asks for no pool. */
  const noTargets = analysis !== null && targets === null;
  const key = wanted && state && context && targets ? `${deckKey(deckBeforeFixes(state))}|${settingsKey(context)}|${generation}` : null;
  // Undo stepped back past the deck the pool was read for (an auto-fix it was read after): its deck cards are not this deck's.
  if (pool && key !== null && pool.key === key && state && state.fixes.length < pool.fixes) setGeneration(generation + 1);

  /** What the request reads, as of the latest render: the request goes out per key, not per render. */
  const inputs = useRef({ state, context });
  useEffect(() => {
    inputs.current = { state, context };
  });
  useEffect(() => {
    const { state, context } = inputs.current;
    if (key === null || !state || !context) return;
    let live = true;
    const fixes = state.fixes.length;
    void getApis()
      .recs.fix({ context: { ...context, deck: workingDeck(state) } })
      .then((r) => {
        if (!live) return;
        setPool({ key, fixes, value: r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.error.message } });
      });
    return () => {
      live = false;
    };
  }, [key]);

  const current = pool !== null && pool.key === key ? pool.value : null;
  const result = current?.status === "ready" ? current.data : null;
  const chosenBracket = context?.bracket ?? null;
  const bracket = useMemo(
    (): BracketInput | null =>
      analysis && chosenBracket !== null ? { chosen: chosenBracket, signals: analysis.bracketSignals, combos: analysis.combos, overBracketAdds } : null,
    [analysis, chosenBracket, overBracketAdds],
  );
  // The journey builds its protected pieces afresh each render: keyed by their ids, so the browser (and the pair the
  // player browsed to) lasts until they change.
  const protectedKey = [...journey.protectedPieces.keys()].join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read through its key, which changes when the ids do
  const protectedPieceIds = useMemo(() => [...journey.protectedPieces.keys()], [protectedKey]);
  const spendLeftUsd = context?.budget?.spendLeftUsd;

  const input = useMemo((): FixInput | null => {
    if (!result || !state || !tally || !targets || !bracket) return null;
    return {
      tally,
      targets,
      bracket,
      pool: result.pool,
      skipped: state.declinedFixes,
      choices,
      addedIds: roundAddedIds(state),
      protectedIds: [...new Set([...comboPiecesToKeep(bracket, targets.bracketLimits), ...protectedPieceIds])],
      illegalIds: result.illegalIds,
      spendLeftUsd,
    };
  }, [result, state, tally, targets, bracket, choices, protectedPieceIds, spendLeftUsd]);

  // The pairs to browse, first nextFixMove's. A new browser (after a move, a skip or a new focus) starts both lists over.
  const browser = useMemo(() => (input ? fixBrowser(focus === null ? input : { ...input, focusLine: focus }) : null), [input, focus]);
  // A cursor set on an earlier browser reads as (0, 0): no state is written while rendering.
  const [cursor, setCursor] = useState<FixCursor>({ browser, out: 0, in: 0 });
  const outIndex = cursor.browser === browser ? cursor.out : 0;
  const inIndex = cursor.browser === browser ? cursor.in : 0;
  const [lengths, setLengths] = useState<FixLengths>({ browser, outs: null, ins: new Map() });
  const known = lengths.browser === browser ? lengths : null;
  const outCount = known?.outs ?? null;
  const inCount = known?.ins.get(outIndex) ?? null;

  /** The pair on screen, which Swap makes and Skip passes on. Every index the cursor reaches has a card. */
  const move = useMemo((): FixMove | null => {
    const out = browser?.out(outIndex) ?? null;
    const cardIn = browser?.in(outIndex, inIndex) ?? null;
    return browser && out && cardIn ? { line: browser.line, out, in: cardIn } : null;
  }, [browser, outIndex, inIndex]);

  // After the pair shows, find the cards a browse would show next, so the tap that asks for them doesn't wait, and fetch
  // their images, so they are dealt face up.
  useEffect(() => {
    if (!browser) return;
    const timer = setTimeout(() => {
      setLengths((l) => learnLengths(l, browser, outIndex, inIndex));
      preloadCardImages(cardsAhead(browser, outIndex, inIndex));
    });
    return () => clearTimeout(timer);
  }, [browser, outIndex, inIndex]);

  /** Moves the cursor, when the card it moves to exists; at an end it learns the list's length instead. */
  const browseTo = (out: number, inAt: number) => {
    if (!browser || out < 0 || inAt < 0) return;
    if (browser.out(out) !== null && browser.in(out, inAt) !== null) setCursor({ browser, out, in: inAt });
    else setLengths((l) => learnLengths(l, browser, outIndex, inIndex));
  };
  // No count is shown (owner, 2026-11-24): a list's length, once known, only says whether › has a card to go to.
  const browse = {
    canNextOut: outCount === null || outIndex + 1 < outCount,
    canPreviousOut: outIndex > 0,
    canNextIn: inCount === null || inIndex + 1 < inCount,
    canPreviousIn: inIndex > 0,
    nextOut: () => browseTo(outIndex + 1, 0),
    previousOut: () => browseTo(outIndex - 1, 0),
    nextIn: () => browseTo(outIndex, inIndex + 1),
    previousIn: () => browseTo(outIndex, inIndex - 1),
  };

  const lines = useMemo((): FixLine[] => (input ? fixLines(input) : []), [input]);

  /** A round's first arrival on Fix with nothing to fix goes on to the next step, once. */
  const ready = input !== null || noTargets;
  const nothingToFix =
    ready && phase === "fix" && move === null && state !== null && state.reached === "fix" && state.fixes.length === 0 && state.declinedFixes.length === 0;
  const { goTo } = journey;
  const skipTo = nothingToFix && state ? nextPhase(state) : null;
  useEffect(() => {
    if (skipTo === null) return;
    // Queued rather than called here: the move sets state, which an effect body must not do synchronously.
    queueMicrotask(() => goTo(skipTo));
    // goTo is rebuilt every render; the step to skip to is what this runs for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipTo]);

  /** A bracket change the deck doesn't fit, part way through Swap or Finish, brings the round back to Fix. */
  const lastBracket = useRef(chosenBracket);
  const overBracket = report !== null && !report.bracket.ok;
  useEffect(() => {
    const changed = lastBracket.current !== null && chosenBracket !== null && lastBracket.current !== chosenBracket;
    lastBracket.current = chosenBracket;
    if (!changed || !overBracket || (phase !== "replace" && phase !== "review")) return;
    queueMicrotask(() => {
      setFocus(BRACKET_LINE);
      goTo("fix");
    });
    // Runs on a bracket change; the phase and the report are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenBracket]);

  const fixCards = useMemo(() => new Map<CardId, FixCard>((result?.pool.ins ?? []).map((c) => [c.card.id, c])), [result]);
  const rolesOf = (card: CardSummary) => card.roles ?? fixCards.get(card.id)?.roles ?? analysis?.cardRoles[card.id] ?? [];
  const tallyCard = (card: CardSummary | null) => (card ? toTallyCard(card, rolesOf(card)) : null);
  const asTallyMove = (m: { in: CardSummary | null; out: CardSummary | null }): TallyMove => ({ in: tallyCard(m.in), out: tallyCard(m.out) });

  /** The score with moves made: the card on screen answered, or the moves selected in the auto-fix preview. */
  /**
   * The deck graded with moves made: the card on screen answered, for Deck stats. Its lines' `start` values are the
   * moved deck's own, so only values and states are read from it.
   */
  function reportWith(moves: readonly { in: CardSummary | null; out: CardSummary | null }[]): DeckStatsReport | null {
    if (!tally || !targets || !bracket) return null;
    return reportWithMoves(tally, targets, bracket, choices, moves.map(asTallyMove));
  }

  /** The score with moves made: the moves selected in the auto-fix preview. */
  function scoreWith(moves: readonly { in: CardSummary | null; out: CardSummary | null }[]): StatScore | null {
    const report = reportWith(moves);
    return report && { okCount: report.okCount, total: report.total };
  }

  /** A line's name and count as Deck stats shows them. */
  function lineLabel(line: string): FixLineLabel {
    if (line === LEGAL_LINE) return { label: "Not legal here" };
    if (line === BRACKET_LINE) return { label: `Bracket ${chosenBracket ?? ""}`.trim() };
    if (line === CURVE_LINE) return { label: "Mana curve" };
    const stat = report?.stats.find((s) => s.key === line);
    return stat ? { label: stat.label, value: stat.value, target: stat.target } : { label: line };
  }

  // "line 2 of 5": the lines Fix's moves already brought in line come first, then the ones still open.
  const open = lines.filter((l) => l.blocked === null).map((l) => l.line);
  const done = [...new Set((state?.fixes ?? []).map((f) => f.line))].filter((line) => !open.includes(line));

  return {
    /** The pool for the deck on screen: loading until it is in. */
    status: (noTargets ? "ready" : (current?.status ?? (wanted ? "loading" : "idle"))) as Async<never>["status"],
    message: current?.status === "error" ? current.message : null,
    /** The pair on screen, or null when no line has a move left (or the pool isn't in). */
    move,
    /** The browse to the line's other pairs. Browsing records nothing. */
    browse,
    /** The in card as the pool sent it: whether it is owned, and the lines it would be bought for. */
    inCard: move ? (fixCards.get(move.in.id) ?? null) : null,
    /** Every counted line outside its band, with why it has no move when it has none. */
    lines,
    /** Where the move's line stands among the lines Fix works through this round, 1-based. */
    position: done.length + 1,
    total: done.length + open.length,
    lineLabel,
    accept: () => {
      if (move) journey.dispatch({ type: "fix", move });
    },
    skip: () => {
      if (move) journey.dispatch({ type: "declineFix", inId: move.in.id, outId: move.out.id });
    },
    /** Every move left, each found on the deck as the ones before leave it: what Auto-Fix previews. */
    plan: (): FixMove[] => (input ? planFixes(input) : []),
    /** Makes the chosen moves as one choice, and reads the pool again for the deck they leave. */
    applyPlan: (moves: readonly FixMove[]) => {
      if (moves.length === 0) return;
      journey.dispatch(...moves.map((m) => ({ type: "fix" as const, move: m })));
      setGeneration((g) => g + 1);
    },
    /** Opens Fix at a line (Deck stats' and Finish's "Fix"); pairs skipped earlier are offered again. */
    openAt: (line: string) => {
      setFocus(line);
      if ((state?.declinedFixes.length ?? 0) > 0) journey.dispatch({ type: "retryFixes" });
      journey.goTo("fix");
    },
    reportWith,
    scoreWith,
    /** Whether Fix knows what it can do: false while the pool loads. */
    ready,
  };
}

export type Fix = ReturnType<typeof useFix>;
