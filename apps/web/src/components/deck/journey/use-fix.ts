"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardId, CardSummary, ComboRef, DeckAnalysis, FixCard, FixResult, RecContext, StatChoices } from "@mtg/core/contract";
import {
  CURVE_LINE,
  comboPiecesToKeep,
  deckBeforeFixes,
  deckKey,
  fixLines,
  nextFixMove,
  nextPhase,
  planFixes,
  roundAddedIds,
  scoreWithMoves,
  toTallyCard,
  workingDeck,
  type BracketInput,
  type DeckStatsReport,
  type FixInput,
  type FixLine,
  type FixMove,
  type TallyMove,
} from "@mtg/core/journey";
import { getApis } from "@/lib/api/client";
import type { Async } from "../use-deck-tool";
import type { DeckJourney } from "./use-deck-journey";

/** The lines Fix names that Deck stats has no row for. */
const LEGAL_LINE = "legal";
const BRACKET_LINE = "bracket";

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

/** The settings a pool was read with, as one comparable value: a change asks for the pool again. */
function settingsKey(context: RecContext): string {
  const { ownership } = context;
  const collection =
    ownership === null
      ? "none"
      : ownership.kind === "session"
        ? `session:${ownership.catalogEpoch}:${ownership.ownedCardIds.length}`
        : `${ownership.kind}:${ownership.deckId ?? ""}`;
  return [context.bracket, context.includeGameChangers, collection, context.ownershipMode ?? "", (context.buyFor ?? []).join(",")].join("|");
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
  const protectedPieces = journey.protectedPieces;

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
      protectedIds: [...new Set([...comboPiecesToKeep(bracket, targets.bracketLimits), ...protectedPieces.keys()])],
      illegalIds: result.illegalIds,
    };
  }, [result, state, tally, targets, bracket, choices, protectedPieces]);

  const move = useMemo(() => (input ? nextFixMove(focus === null ? input : { ...input, focusLine: focus }) : null), [input, focus]);
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
  function scoreWith(moves: readonly { in: CardSummary | null; out: CardSummary | null }[]): StatScore | null {
    if (!tally || !targets || !bracket) return null;
    const { okCount, total } = scoreWithMoves(tally, targets, bracket, choices, moves.map(asTallyMove));
    return { okCount, total };
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
    /** The next move, or null when no line has one left (or the pool isn't in). */
    move,
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
    /** Every move left, each found on the deck as the ones before leave it: what "Fix the rest for me" previews. */
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
    scoreWith,
    /** Whether Fix knows what it can do: false while the pool loads. */
    ready,
  };
}

export type Fix = ReturnType<typeof useFix>;
