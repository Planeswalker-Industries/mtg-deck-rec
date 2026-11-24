"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import type { DeckId, SavedDeckSummary } from "@mtg/core/contract";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import { cn } from "cn";
import { COLOR_NAMES, MANA_SYMBOL_URL, PIP_LG_PX } from "@/components/deck/color-identity";
import { ErrorText } from "@/components/ui/error-text";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getApis } from "@/lib/api/client";
import { PHONE_HIT_AREA, PILL_OFF, PILL_ON, TEXT_LINK } from "@/lib/constants";
import { DeckTile, WUBRG, identityOf, type MenuUp } from "./deck-tile";

/** Below this many decks the filter and sort tools are clutter; the cap is 100, so they earn their place well before then. */
const FILTER_FROM = 8;
/** The grid's columns from sm and from lg up (phones have 2, and open the actions as a sheet, so their rows don't matter). */
const COLUMNS_SM = 3;
const COLUMNS_LG = 4;
/** Colourless, as a filter: decks whose identity is empty. */
const COLORLESS = "C";
const COLOR_FILTERS = [...WUBRG, COLORLESS];

type Sort = "recent" | "name" | "color";
const SORT_LABELS: Record<Sort, string> = { recent: "Last updated", name: "Name", color: "Colours" };

/** WUBRG order by colour count first, so mono decks come before pairs: "" < "W" < "U" < … < "WU" < … */
function colorKey(identity: string): string {
  return `${identity.length}${[...identity].map((c) => WUBRG.indexOf(c)).join("")}`;
}

function isLastRow(index: number, count: number, columns: number): boolean {
  return index >= count - (count % columns || columns);
}

export function DeckList({ decks }: { decks: SavedDeckSummary[] }) {
  const [filter, setFilter] = useState("");
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>("recent");
  const [error, setError] = useState<string | null>(null);
  // The one selected tile (hovered, tapped once or focused): it grows and shows its actions.
  const [active, setActive] = useState<DeckId | null>(null);
  // One clock for the whole list, so every tile's "Updated …" agrees.
  const [now] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matches = decks.filter((d) => {
      if (needle && !d.name.toLowerCase().includes(needle)) return false;
      if (colors.size === 0) return true;
      const identity = identityOf(d);
      // Colourless is its own identity; the colours ask for decks that play every one picked.
      if (colors.has(COLORLESS)) return identity === "" && colors.size === 1;
      return [...colors].every((c) => identity.includes(c));
    });
    if (sort === "name") return matches.toSorted((a, b) => a.name.localeCompare(b.name));
    if (sort === "color") {
      return matches.toSorted((a, b) => colorKey(identityOf(a)).localeCompare(colorKey(identityOf(b))) || a.name.localeCompare(b.name));
    }
    // The server already lists them newest first.
    return matches;
  }, [decks, filter, colors, sort]);

  // A tap or click anywhere outside the selected tile clears it; a tap on another tile then selects that one.
  useEffect(() => {
    if (active === null) return;
    function onPointerDown(e: PointerEvent) {
      const tile = (e.target as Element | null)?.closest("[data-deck-tile]");
      if (tile?.getAttribute("data-deck-tile") !== String(active)) setActive(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active]);

  /** Each action revalidates /decks on the server, so the list re-renders with fresh data. */
  function run(work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>) {
    setError(null);
    setActive(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error.message);
    });
  }

  function toggleColor(color: string) {
    setColors((current) => {
      const next = new Set(current);
      if (next.has(color)) next.delete(color);
      // Colourless and the colours exclude each other, so picking one clears the other kind.
      else if (color === COLORLESS) return new Set([COLORLESS]);
      else {
        next.delete(COLORLESS);
        next.add(color);
      }
      return next;
    });
  }

  const filtering = filter.trim() !== "" || colors.size > 0;

  return (
    <div className="flex flex-col gap-6">
      {decks.length >= FILTER_FROM && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            maxLength={MAX_DECK_NAME_CHARS}
            placeholder="Filter by name"
            aria-label="Filter decks by name"
            className="h-11 bg-sleeve sm:h-10 sm:max-w-xs"
          />
          <div role="group" aria-label="Filter by colour" className="flex flex-wrap gap-2">
            {COLOR_FILTERS.map((color) => (
              <button
                key={color}
                type="button"
                aria-pressed={colors.has(color)}
                aria-label={COLOR_NAMES[color]}
                title={COLOR_NAMES[color]}
                onClick={() => toggleColor(color)}
                className={cn(
                  PHONE_HIT_AREA,
                  "rounded-full border p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  colors.has(color) ? PILL_ON : PILL_OFF,
                )}
              >
                <Image src={MANA_SYMBOL_URL(color)} alt="" width={PIP_LG_PX} height={PIP_LG_PX} unoptimized className="size-6" />
              </button>
            ))}
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
            <SelectTrigger aria-label="Sort decks" className="h-11 w-full bg-sleeve sm:ml-auto sm:h-10 sm:w-44">
              <SelectValue>Sort: {SORT_LABELS[sort]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && <ErrorText className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">{error}</ErrorText>}

      {shown.length === 0 ? (
        <p className="text-muted-foreground">
          No deck matches.{" "}
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setFilter("");
                setColors(new Set());
              }}
              className={cn(TEXT_LINK, "font-semibold")}
            >
              Clear filters
            </button>
          )}
        </p>
      ) : (
        <ul className={cn("grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-8 lg:grid-cols-4", pending && "opacity-60")}>
          {shown.map((deck, index) => {
            const menuUp: MenuUp = {
              sm: isLastRow(index, shown.length, COLUMNS_SM),
              lg: isLastRow(index, shown.length, COLUMNS_LG),
            };
            return (
              <DeckTile
                key={deck.id}
                deck={deck}
                active={active === deck.id}
                menuUp={menuUp}
                now={now}
                onActivate={() => setActive(deck.id)}
                onDeactivate={() => setActive((current) => (current === deck.id ? null : current))}
                onDuplicate={() => run(() => getApis().actions.duplicateDeck({ deckId: deck.id }))}
                onDelete={() => {
                  // Deleting is not undoable and the deck may already be shared, so confirm first.
                  if (!window.confirm(`Delete “${deck.name}”? This can't be undone.`)) return;
                  run(() => getApis().actions.deleteDeck({ deckId: deck.id }));
                }}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
