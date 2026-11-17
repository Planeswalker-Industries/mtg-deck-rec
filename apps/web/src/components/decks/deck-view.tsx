"use client";

import { useSyncExternalStore } from "react";
import { Funnel, LayoutGrid, List } from "lucide-react";
import { cn } from "cn";
import { CARD_SORTS, DEFAULT_CARD_SORT, type CardSort } from "@mtg/core/journey";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * One choice a page remembers in this browser (its view, its sort). The server and the first render show the page's
 * default, so hydration matches; when storage is blocked, the choice as last made on this page stands in.
 */
function rememberedChoice<V extends string>(settings: Record<DeckViewPage, { key: string; fallback: V }>, valid: readonly V[]) {
  const memory = new Map<DeckViewPage, V>();
  const read = (page: DeckViewPage): V => {
    const { key, fallback } = settings[page];
    try {
      const stored = localStorage.getItem(key);
      return valid.find((v) => v === stored) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (page: DeckViewPage, value: V) => {
    try {
      localStorage.setItem(settings[page].key, value);
    } catch {
      // Storage is blocked; the choice holds for this page only.
    }
    memory.set(page, value);
    listeners.forEach((listener) => listener());
  };
  return function useChoice(page: DeckViewPage): [V, (value: V) => void] {
    const value = useSyncExternalStore(
      subscribe,
      () => memory.get(page) ?? read(page),
      () => settings[page].fallback,
    );
    return [value, (next: V) => write(page, next)];
  };
}

const useViewChoice = rememberedChoice<DeckView>(
  VIEW_SETTINGS,
  VIEWS.map((v) => v.view),
);

/** The view in use on a page. */
export function useDeckView(page: DeckViewPage = "deck"): [DeckView, (view: DeckView) => void] {
  return useViewChoice(page);
}

/** Where each page remembers its sort; both open sorted by mana value. */
const SORT_SETTINGS = {
  deck: { key: "mtg-deck-rec:deck-sort", fallback: DEFAULT_CARD_SORT },
  build: { key: "mtg-deck-rec:build-sort", fallback: DEFAULT_CARD_SORT },
} as const satisfies Record<DeckViewPage, { key: string; fallback: CardSort }>;
const SORT_LABELS: Record<CardSort, string> = { name: "Name", cost: "Cost", color: "Color", price: "Price" };

const useSortChoice = rememberedChoice<CardSort>(SORT_SETTINGS, CARD_SORTS);

/** The sort in use on a page, remembered apart from the other page's. */
export function useCardSort(page: DeckViewPage): [CardSort, (sort: CardSort) => void] {
  return useSortChoice(page);
}

/** A funnel button that opens Name, Cost, Color or Price; sits next to the Images/List toggle. */
export function SortMenu({ sort, onChange, className }: { sort: CardSort; onChange: (sort: CardSort) => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Sort cards: ${SORT_LABELS[sort]}`}
          className={cn(
            PHONE_HIT_AREA,
            "inline-flex h-7 items-center rounded-md px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            TOGGLE_OFF,
            className,
          )}
        >
          <Funnel aria-hidden className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onChange(CARD_SORTS.find((s) => s === value) ?? DEFAULT_CARD_SORT)}>
          {CARD_SORTS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SORT_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Images or List, for every card on a saved deck's page or a built deck. */
export function DeckViewToggle({ view, onChange, className }: { view: DeckView; onChange: (view: DeckView) => void; className?: string }) {
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
          {label}
        </button>
      ))}
    </div>
  );
}
