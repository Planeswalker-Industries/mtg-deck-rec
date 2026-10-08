"use client";

import { useMemo, useState } from "react";
import type { Bracket, CardId, CardSummary, DeckAnalysis } from "@mtg/core/contract";
import { tallyCache, toTallyCard, type DeckStatsReport, type TallyEntry } from "@mtg/core/journey";
import type { DeckEntry } from "@mtg/core/scoring";

const NO_IDS: ReadonlySet<CardId> = new Set();

/**
 * Deck stats for the deck on screen. The tally is counted in full once per analysis and then moved only by the cards
 * that changed (`tallyCache`); a card's roles come from its suggestion or, for the deck's own cards, the analysis.
 * `start`, the deck the round started from, draws the round-start ticks; without it there are none.
 */
export function useDeckStats({
  analysis,
  entries,
  bracket,
  overBracketIds = NO_IDS,
  start,
}: {
  analysis: DeckAnalysis | null;
  /** The deck as it stands, commanders included or not: commanders are taken from the analysis. */
  entries: readonly DeckEntry[];
  bracket: Bracket | null;
  overBracketIds?: ReadonlySet<CardId>;
  /** The deck the round started from, commanders included or not; keep one array per round, as for `entries`. */
  start?: readonly DeckEntry[] | undefined;
}): DeckStatsReport | null {
  // A stable object whose method is called during the memo; it keeps the tally between renders.
  const [cache] = useState(tallyCache);
  return useMemo(() => {
    const targets = analysis?.statTargets;
    if (!analysis || !targets || bracket === null) return null;
    const rolesOf = (card: CardSummary) => card.roles ?? analysis.cardRoles[card.id] ?? [];
    const commanderIds = new Set<CardId>(analysis.deck.commanders);
    const tallied = (list: readonly DeckEntry[]): TallyEntry[] =>
      list
        .filter((e) => !commanderIds.has(e.card.id))
        .map((e) => ({ card: toTallyCard(e.card, rolesOf(e.card)), quantity: e.quantity }));
    const commanders = analysis.commanderKey.commanders.map((c) => toTallyCard(c, rolesOf(c)));
    return cache.report(
      analysis,
      tallied(entries),
      commanders,
      targets,
      { chosen: bracket, signals: analysis.bracketSignals, combos: analysis.combos, overBracketIds },
      start && tallied(start),
    );
  }, [cache, analysis, entries, bracket, overBracketIds, start]);
}
