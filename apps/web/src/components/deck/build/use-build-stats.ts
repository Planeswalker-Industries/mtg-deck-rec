"use client";

import { useEffect, useMemo, useState } from "react";
import type { Bracket, BuildResult, DeckAnalysis } from "@mtg/core/contract";
import type { DeckEntry } from "@mtg/core/scoring";
import { getApis } from "@/lib/api/client";
import { useDeckStats } from "../deck-stats/use-deck-stats";
import { buildCards, buildEntries } from "./use-deck-build";

/**
 * Deck stats for a built deck: the decklist is read like a pasted one, so the build page grades it with the analysis,
 * targets and tally Add will use after Continue. Null until the analysis is in, or when it fails.
 */
export function useBuildStats(result: BuildResult | null, decklist: string | null, bracket: Bracket) {
  const [analysed, setAnalysed] = useState<{ text: string; analysis: DeckAnalysis | null } | null>(null);
  useEffect(() => {
    if (decklist === null) return;
    let live = true;
    void getApis()
      .actions.parseDeck({ text: decklist })
      .then((r) => {
        if (live) setAnalysed({ text: decklist, analysis: r.ok ? r.data.analysis : null });
      });
    return () => {
      live = false;
    };
  }, [decklist]);
  const analysis = analysed?.text === decklist ? analysed.analysis : null;
  const entries = useMemo((): DeckEntry[] => {
    if (!result) return [];
    const cards = buildCards(result);
    return [
      ...result.commanderKey.commanders.map((card) => ({ card, quantity: 1 })),
      ...buildEntries(result).flatMap((e) => {
        const card = cards.get(e.cardId);
        return card ? [{ card, quantity: e.quantity }] : [];
      }),
    ];
  }, [result]);
  return useDeckStats({ analysis, entries, bracket });
}
