"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSummary } from "@mtg/core/contract";
import { setCardQuantity } from "@mtg/core/collection";
import { getApis } from "@/lib/api/client";
import { loadCollection, updateCollectionRows } from "@/lib/collection-store";
import type { CollectionViewItem } from "./use-collection-view";

/**
 * A card's count settles this long after its last click before it's written, so tapping + five times is one write of
 * the final count rather than five.
 */
const WRITE_DEBOUNCE_MS = 500;

/**
 * Edits to the collection on screen: copies of a card up or down, a card taken out, a new card put in.
 *
 * The page changes at once and the write follows, per card, after a short pause. A write that fails puts the card
 * back to the count it had before and says why. An account collection is written through the server; a browser one
 * is rewritten in IndexedDB, by the same rule the server follows (@mtg/core/collection setCardQuantity).
 */
export function useCollectionEditor(initial: CollectionViewItem[], where: "browser" | "account") {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** The count each waiting card will be written at, so leaving the page can write it rather than drop it. */
  const waitingWrites = useRef(new Map<number, { card: CardSummary; quantity: number }>());
  /** The count each card had when its first unsaved change was made, to go back to if the write fails. */
  const before = useRef(new Map<number, CollectionViewItem | null>());

  async function write(card: CardSummary, quantity: number) {
    setSaving((n) => n + 1);
    try {
      if (where === "account") {
        const r = await getApis().actions.setCollectionCardQuantity({ cardId: card.id, quantity });
        if (!r.ok) throw new Error(r.error.message);
      } else {
        const stored = await loadCollection();
        if (!stored) throw new Error("This browser's collection has expired. Import it again.");
        await updateCollectionRows(stored, setCardQuantity(stored.rows, card.id, quantity));
      }
      before.current.delete(card.id);
    } catch (err) {
      const previous = before.current.get(card.id);
      before.current.delete(card.id);
      setItems((list) => {
        const rest = list.filter((i) => i.card.id !== card.id);
        return previous ? [...rest, previous] : rest;
      });
      setError(`${card.name}: ${err instanceof Error ? err.message : "couldn't be saved."}`);
    } finally {
      setSaving((n) => n - 1);
    }
  }

  function setQuantity(card: CardSummary, quantity: number) {
    const next = Math.max(0, quantity);
    const current = items.find((i) => i.card.id === card.id) ?? null;
    if (!before.current.has(card.id)) before.current.set(card.id, current);
    setError(null);
    setItems((list) => {
      const rest = list.filter((i) => i.card.id !== card.id);
      if (next === 0) return rest;
      return [...rest, current ? { ...current, quantity: next } : { card, tags: [], quantity: next, setCodes: [] }];
    });
    const timer = timers.current.get(card.id);
    if (timer) clearTimeout(timer);
    timers.current.set(
      card.id,
      setTimeout(() => {
        timers.current.delete(card.id);
        waitingWrites.current.delete(card.id);
        setWaiting(timers.current.size);
        void write(card, next);
      }, WRITE_DEBOUNCE_MS),
    );
    waitingWrites.current.set(card.id, { card, quantity: next });
    setWaiting(timers.current.size);
  }

  // Leaving the page writes whatever was still waiting for its pause.
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      for (const { card, quantity } of waitingWrites.current.values()) void write(card, quantity);
    },
    // write only reads refs and the collection's location, which never changes for this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const quantityOf = (card: CardSummary) => items.find((i) => i.card.id === card.id)?.quantity ?? 0;

  return {
    items,
    error,
    /** Writes in flight or waiting for their pause. */
    saving: saving > 0 || waiting > 0,
    quantityOf,
    setQuantity,
    add: (card: CardSummary) => setQuantity(card, quantityOf(card) + 1),
  };
}

export type CollectionEditor = ReturnType<typeof useCollectionEditor>;
