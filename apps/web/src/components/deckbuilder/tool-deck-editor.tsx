"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { CardSummary, DeckAnalysis } from "@mtg/core/contract";
import { decklistFor } from "@mtg/core/journey";
import type { DeckTool } from "@/components/deck/use-deck-tool";
import type { BuilderCollection } from "./card-search-panel";
import { DeckBuilder } from "./deck-builder";
import { useDeckBuilder } from "./use-deck-builder";

/**
 * Edits settle this long before they go back into the decklist. Each write re-reads the deck, a request in the `deck`
 * bucket, so it waits for a pause rather than following clicks.
 */
const COMMIT_DEBOUNCE_MS = 1500;

/**
 * The inline deckbuilder's pending edit, for the deck tool around it.
 *
 * `flush` writes an edit still waiting for its pause and resolves to the deck as analyzed afterwards (null: nothing
 * waited). `recs` asks for the cuts with it, for when the player is on their way back to Upgrade. `discard` drops a
 * waiting edit, for when the deck in the tool is about to be replaced (a new analysis, Clear) and the edit belongs to
 * the deck being replaced.
 */
export interface EditorHandle {
  flush: (options?: { recs?: boolean }) => Promise<DeckAnalysis | null>;
  discard: () => void;
  /** Whether an edit is waiting for its pause. */
  hasPending: () => boolean;
}

/**
 * The deckbuilder inside the deck tool, for a deck that isn't saved yet (a saved deck has its own editor page). Edits
 * are written back into the decklist box as a clean list and analyzed, so Upgrade, the remembered deck and Save all
 * see the deck as it now stands. Suggestions are not asked for on the way: nothing here shows them, and Upgrade loads
 * them when the player goes back to it.
 */
export function ToolDeckEditor({
  tool,
  handleRef,
  onCommitted,
  collection,
}: {
  tool: DeckTool;
  /** The deck tool's collection setting, which the search panel shows as Owned only / All cards. */
  collection?: BuilderCollection | undefined;
  handleRef?: RefObject<EditorHandle | null>;
  /** Each edit once it has been analyzed, e.g. so a new commander gets the deck lookup offer. */
  onCommitted?: (analysis: DeckAnalysis | null) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  /*
   * The tool as of the latest render. A write can run long after the edit that queued it (the pause, leaving the
   * builder), and the tool's functions close over its state, so an old one would put back an old bracket or collection
   * setting along with the edit.
   */
  const toolRef = useRef(tool);
  const committedRef = useRef(onCommitted);
  useEffect(() => {
    toolRef.current = tool;
    committedRef.current = onCommitted;
  });
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

  function discard() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }

  async function flush({ recs = false }: { recs?: boolean } = {}): Promise<DeckAnalysis | null> {
    const text = pending.current;
    discard();
    if (text === null) return null;
    const outcome = await toolRef.current.commitText(text, { recs });
    committedRef.current?.(outcome.analysis);
    return outcome.analysis;
  }

  // Save and the deck tool's own controls ask for the flush before they act, so they act on the deck as edited rather
  // than a pause behind. Leaving the builder (back to Upgrade, or away) writes a waiting edit rather than losing it; one
  // the tool discarded is already gone.
  useEffect(() => {
    if (handleRef) handleRef.current = { flush, discard, hasPending: () => pending.current !== null };
    return () => {
      if (handleRef) handleRef.current = null;
      void flush({ recs: true });
    };
    // flush and discard read refs only, so the pair from the first render stays correct for the builder's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DeckBuilder builder={builder} analysis={analysis} swapContext={tool.context} showIssues={false} collection={collection} />;
}
