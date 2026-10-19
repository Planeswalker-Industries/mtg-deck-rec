"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { CardId, CardRules } from "@mtg/core/contract";
import { MAX_CARD_RULES_IDS } from "@mtg/core/schemas";
import { getApis } from "@/lib/api/client";

/**
 * Rules text for the cards a journey step has on screen, fetched once per card per page load and shared by every
 * panel. A card the catalog doesn't know is remembered as null, so it isn't asked for again.
 */
const cache = new Map<CardId, CardRules | null>();
const pending = new Set<CardId>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version++;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => version;

/** Asks for the cards not yet held or on their way, in batches the route accepts. A failure leaves them to ask again. */
function request(ids: readonly CardId[]) {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id) && !pending.has(id));
  for (let at = 0; at < missing.length; at += MAX_CARD_RULES_IDS) {
    const batch = missing.slice(at, at + MAX_CARD_RULES_IDS);
    for (const id of batch) pending.add(id);
    void getApis()
      .catalog.cardRules({ cardIds: batch })
      .then((result) => {
        for (const id of batch) pending.delete(id);
        if (!result.ok) return;
        const found = new Map(result.data.map((rules) => [rules.cardId, rules]));
        for (const id of batch) cache.set(id, found.get(id) ?? null);
        notify();
      });
  }
}

/**
 * The rules for `ids`, asking for any not yet held. Returns a lookup: undefined while a card is on its way, null when
 * the catalog has nothing for it. Pass the next few cards of a queue too, so they are in hand before they're dealt.
 */
export function useCardRules(ids: readonly CardId[]): (id: CardId) => CardRules | null | undefined {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = ids.join(",");
  useEffect(() => {
    if (key) request(key.split(",").map((id) => Number(id) as CardId));
  }, [key]);
  return (id) => cache.get(id);
}
