"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { CardSummary } from "@mtg/core/contract";

/** The answer on screen: the card it would put in, the card it would take out. Either may be absent. */
export interface StatPreview {
  add: CardSummary | null;
  remove: CardSummary | null;
}

const SetPreview = createContext<((preview: StatPreview | null) => void) | null>(null);

/** Lets a journey step tell Deck stats which card is on screen, so it can show what answering it would change. */
export function StatPreviewProvider({ onChange, children }: { onChange: (preview: StatPreview | null) => void; children: ReactNode }) {
  return <SetPreview.Provider value={onChange}>{children}</SetPreview.Provider>;
}

/**
 * Called by a step while it shows one card: Deck stats previews accepting it until the card changes or the step leaves.
 * Outside a provider (the card rater) it does nothing.
 */
export function useStatPreview(add: CardSummary | null, remove: CardSummary | null) {
  const set = useContext(SetPreview);
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
