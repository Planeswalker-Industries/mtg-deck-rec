"use client";

import { useSyncExternalStore } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "cn";
import { TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";

/** How a saved deck's cards show: whole card images, or one plate per card. */
export type DeckView = "images" | "plates";

/** Remembered in this browser, so a player who prefers plates gets them on every deck they open. */
const DECK_VIEW_KEY = "mtg-deck-rec:deck-view";
const DEFAULT_VIEW: DeckView = "images";
const VIEWS: { view: DeckView; label: string; icon: typeof LayoutGrid }[] = [
  { view: "images", label: "Images", icon: LayoutGrid },
  { view: "plates", label: "List", icon: List },
];

const listeners = new Set<() => void>();
/** The choice as last made on this page, which stands in when storage is blocked. */
let memory: DeckView | null = null;

function readView(): DeckView {
  try {
    return localStorage.getItem(DECK_VIEW_KEY) === "plates" ? "plates" : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeView(view: DeckView) {
  try {
    localStorage.setItem(DECK_VIEW_KEY, view);
  } catch {
    // Storage is blocked; the choice holds for this page only.
  }
  memory = view;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The deck view in use. The server and the first render show images, so hydration matches. */
export function useDeckView(): [DeckView, (view: DeckView) => void] {
  const view = useSyncExternalStore(subscribe, () => memory ?? readView(), () => DEFAULT_VIEW);
  return [view, writeView];
}

/** Images or List, for every card on a saved deck's page. */
export function DeckViewToggle({ view, onChange }: { view: DeckView; onChange: (view: DeckView) => void }) {
  return (
    <div role="group" aria-label="Show cards as" className="flex gap-1 self-end">
      {VIEWS.map(({ view: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors sm:min-h-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            view === v ? TOGGLE_ON : TOGGLE_OFF,
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
