"use client";

import { useEffect, useRef } from "react";
import type { CardSummary } from "@mtg/core/contract";
import { decklistFor } from "@mtg/core/journey";
import type { DeckTool } from "@/components/deck/use-deck-tool";
import { DeckBuilder } from "./deck-builder";
import { useDeckBuilder } from "./use-deck-builder";

/**
 * Edits settle this long before they go back into the decklist. Each write re-reads the deck and reloads its
 * suggestions, three requests in the `deck` and `recs` buckets, so it waits for a pause rather than following clicks.
 */
const COMMIT_DEBOUNCE_MS = 1500;

/**
 * The deckbuilder inside the deck tool, for a deck that isn't saved yet (a saved deck has its own editor page). Edits
 * are written back into the decklist box as a clean list and analyzed, so Upgrade, the remembered deck and Save all
 * see the deck as it now stands.
 */
export function ToolDeckEditor({ tool }: { tool: DeckTool }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const analysis = tool.analysis;
  const initialCards: CardSummary[] = [
    ...tool.lines.flatMap(({ resolution }) => (resolution.status === "resolved" ? [resolution.card] : [])),
    ...(analysis?.commanderKey.commanders ?? []),
  ];

  const builder = useDeckBuilder({
    initialDeck: analysis?.deck ?? { commanders: [], cards: [] },
    initialCards,
    onChange: (next, cards) => {
      if (timer.current) clearTimeout(timer.current);
      pending.current = () => void tool.commitText(decklistFor(next, (id) => cards.get(id)?.name ?? null));
      timer.current = setTimeout(() => {
        pending.current?.();
        pending.current = null;
      }, COMMIT_DEBOUNCE_MS);
    },
  });

  // Leaving the editor (back to Upgrade, or away) writes an edit that was still waiting, rather than losing it.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );

  return <DeckBuilder builder={builder} analysis={analysis} swapContext={tool.context} showIssues={false} />;
}
