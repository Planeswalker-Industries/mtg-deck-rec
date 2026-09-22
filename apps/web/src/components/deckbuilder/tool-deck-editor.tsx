"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { CardSummary, DeckAnalysis } from "@mtg/core/contract";
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
/** Writes an edit still waiting for its pause, and resolves to the deck as analyzed afterwards (null: nothing waited). */
export type FlushEdits = () => Promise<DeckAnalysis | null>;

export function ToolDeckEditor({ tool, flushRef }: { tool: DeckTool; flushRef?: RefObject<FlushEdits | null> }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
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
      pending.current = decklistFor(next, (id) => cards.get(id)?.name ?? null);
      timer.current = setTimeout(() => void flush(), COMMIT_DEBOUNCE_MS);
    },
  });

  async function flush(): Promise<DeckAnalysis | null> {
    if (timer.current) clearTimeout(timer.current);
    const text = pending.current;
    pending.current = null;
    if (text === null) return null;
    return (await tool.commitText(text)).analysis;
  }

  // Save asks for the flush before it writes, so it saves the deck as edited rather than a debounce behind. Leaving
  // the editor (back to Upgrade, or away) writes a waiting edit rather than losing it.
  useEffect(() => {
    if (flushRef) flushRef.current = flush;
    return () => {
      if (flushRef) flushRef.current = null;
      void flush();
    };
    // flush reads refs and the tool's commitText, which stays the same function for the tool's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DeckBuilder builder={builder} analysis={analysis} swapContext={tool.context} showIssues={false} />;
}
