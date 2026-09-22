"use client";

import { useSyncExternalStore } from "react";
import { Library, X } from "lucide-react";
import Link from "next/link";

/** Remembered per browser, so someone who doesn't want this doesn't meet it on every deck they open. */
const DISMISSED_KEY = "mtg-deck-rec:collection-prompt-dismissed";

const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage is blocked; the prompt simply shows.
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // It just won't stay dismissed next visit.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * Invites the player to import their collection, from the deck they're already working on.
 *
 * This is the moment worth asking: they can see the cards the tool wants them to add, and the useful question is
 * which of those they already own. The link goes to the collection page, whose summary leads straight back here, and
 * the deck is remembered in this browser, so the round trip returns them to the deck they left.
 *
 * Shown only when there is no collection at all. Once there is one, the deck bar's "My collection" choice is the
 * control that matters and this has nothing left to say.
 *
 * The dismissal is read through `useSyncExternalStore` rather than an effect: its server snapshot is "hidden", so
 * the markup matches on both sides and a dismissed prompt never flashes up before going away.
 */
export function CollectionPrompt() {
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);

  if (dismissed) return null;

  return (
    <aside className="relative rounded-xl border border-primary/30 bg-primary/5 p-3">
      <button
        type="button"
        aria-label="Dismiss the collection suggestion"
        onClick={dismiss}
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <X aria-hidden className="size-4" />
      </button>
      <p className="flex items-center gap-2 pr-6 font-heading text-lg leading-none font-semibold">
        <Library aria-hidden className="size-4 shrink-0 text-primary" />
        Swaps you can make tonight
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Import your collection and the tool will suggest cards you already own, instead of ones you&apos;d have to buy.
      </p>
      <Link
        href="/collection/import"
        className="mt-3 inline-block text-sm font-bold text-primary underline-offset-4 hover:underline"
      >
        Import your collection
      </Link>
    </aside>
  );
}
