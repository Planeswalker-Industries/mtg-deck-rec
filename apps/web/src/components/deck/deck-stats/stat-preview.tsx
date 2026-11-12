"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { CardSummary } from "@mtg/core/contract";
import type { StatChip } from "./stat-chips";

/** The answer on screen: the card it would put in, the card it would take out. Either may be absent. */
export interface StatPreview {
  add: CardSummary | null;
  remove: CardSummary | null;
}

interface StatPreviewValue {
  /** Tells Deck stats which card is on screen. */
  onChange: (preview: StatPreview | null) => void;
  /** The Deck stats lines a card in and a card out would move: the chips shown by the card. */
  chipsFor: (add: CardSummary | null, remove: CardSummary | null) => StatChip[];
}

const Preview = createContext<StatPreviewValue | null>(null);

/**
 * Lets a journey step tell Deck stats which card is on screen, so its footer can show the score answering it would
 * give, and lets the step read the lines the card would move (`useStatChips`).
 */
export function StatPreviewProvider({ onChange, chipsFor, children }: StatPreviewValue & { children: ReactNode }) {
  return <Preview.Provider value={{ onChange, chipsFor }}>{children}</Preview.Provider>;
}

/**
 * Called by a step while it shows one card: Deck stats previews accepting it until the card changes or the step leaves.
 * Outside a provider (the card rater) it does nothing.
 */
export function useStatPreview(add: CardSummary | null, remove: CardSummary | null) {
  const set = useContext(Preview)?.onChange;
  const addId = add?.id ?? null;
  const removeId = remove?.id ?? null;
  useEffect(() => {
    if (!set) return;
    set(addId === null && removeId === null ? null : { add, remove });
    return () => set(null);
    // The cards are read when their ids change; a new object for the same card changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, addId, removeId]);
}

/** The lines the card on screen would move; none outside a provider (the card rater). */
export function useStatChips(add: CardSummary | null, remove: CardSummary | null): StatChip[] {
  return useContext(Preview)?.chipsFor(add, remove) ?? [];
}
