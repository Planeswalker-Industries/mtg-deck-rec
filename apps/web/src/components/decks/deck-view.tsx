"use client";

import { useSyncExternalStore } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "cn";
import { PHONE_HIT_AREA, TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";

/** How a deck's cards show: whole card images, or one plate per card. */
export type DeckView = "images" | "plates";

/**
 * Where each page remembers its view in this browser, and what it shows first: a saved deck opens on images; a built
 * deck opens on plates, since the player reads it as a list before going through it card by card.
 */
const VIEW_SETTINGS = {
  deck: { key: "mtg-deck-rec:deck-view", fallback: "images" },
  build: { key: "mtg-deck-rec:build-view", fallback: "plates" },
} as const satisfies Record<string, { key: string; fallback: DeckView }>;
export type DeckViewPage = keyof typeof VIEW_SETTINGS;
const VIEWS: { view: DeckView; label: string; icon: typeof LayoutGrid }[] = [
  { view: "images", label: "Images", icon: LayoutGrid },
  { view: "plates", label: "List", icon: List },
];

const listeners = new Set<() => void>();
/** The choices as last made on this page, which stand in when storage is blocked. */
const memory = new Map<DeckViewPage, DeckView>();

function readView(page: DeckViewPage): DeckView {
  const { key, fallback } = VIEW_SETTINGS[page];
  try {
    const stored = localStorage.getItem(key);
    return stored === "plates" || stored === "images" ? stored : fallback;
  } catch {
    return fallback;
  }
}

function writeView(page: DeckViewPage, view: DeckView) {
  try {
    localStorage.setItem(VIEW_SETTINGS[page].key, view);
  } catch {
    // Storage is blocked; the choice holds for this page only.
  }
  memory.set(page, view);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The view in use on a page. The server and the first render show the page's default, so hydration matches. */
export function useDeckView(page: DeckViewPage = "deck"): [DeckView, (view: DeckView) => void] {
  const view = useSyncExternalStore(subscribe, () => memory.get(page) ?? readView(page), () => VIEW_SETTINGS[page].fallback);
  return [view, (next: DeckView) => writeView(page, next)];
}

/**
 * Images or List, for every card on a saved deck's page or a built deck. `compact` shows the icons alone on phones (the
 * names stay for screen readers), so the toggle fits beside a saved deck's switches.
 */
export function DeckViewToggle({
  view,
  onChange,
  className,
  compact = false,
}: {
  view: DeckView;
  onChange: (view: DeckView) => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Show cards as" className={cn("flex gap-1 self-end", className)}>
      {VIEWS.map(({ view: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            PHONE_HIT_AREA,
            "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            view === v ? TOGGLE_ON : TOGGLE_OFF,
          )}
        >
          <Icon aria-hidden className="size-3.5" />
          <span className={compact ? "max-sm:sr-only" : undefined}>{label}</span>
        </button>
      ))}
    </div>
  );
}
