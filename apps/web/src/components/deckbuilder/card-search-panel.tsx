"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Crown, Plus, Search } from "lucide-react";
import type { CardCategory, CardSummary } from "@mtg/core/contract";
import { canAdd, CURVE_TOP_MANA_VALUE } from "@mtg/core/journey";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";
import { cardCategoryLabel } from "@/lib/labels";
import type { DeckBuilderState } from "./use-deck-builder";

/**
 * Typing waits this long before searching, so a word is one request rather than one per letter. It has to sit above a
 * comfortable typing cadence or it stops debouncing anything: at 250 ms, a phone typist at ~320 ms a character fired a
 * request on all seventeen letters of "angel of serenity" and pulled 5.5 MB of card images doing it.
 */
const SEARCH_DEBOUNCE_MS = 350;
/** Results per page; "More cards" asks for the next page. */
const PAGE_SIZE = 20;
/** A name search needs this many letters; with fewer, the filters alone decide. */
const MIN_NAME_CHARS = 2;

const TYPES: CardCategory[] = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "land", "battle"];
const MANA_VALUES = Array.from({ length: CURVE_TOP_MANA_VALUE + 1 }, (_, i) => i);

interface Query {
  name: string;
  cardType: CardCategory | undefined;
  manaValue: number | undefined;
}

/**
 * There is deliberately no "loading" state here. A search in flight is tracked beside the results, not in place of
 * them, so the cards already on screen stay on screen while the next answer is on its way: replacing them unmounted
 * twenty images, collapsed the grid, and made every keystroke a blank panel that slowly filled back in — including
 * for the cards both searches had in common, whose images were already decoded.
 */
type Results =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; cards: CardSummary[]; more: boolean };

const isLegendaryCreature = (card: CardSummary) => {
  const front = card.typeLine.split(" // ")[0] ?? card.typeLine;
  return /\bLegendary\b/.test(front) && /\bCreature\b/.test(front);
};

/**
 * A search needs a name of two letters or more, or a type or cost pill. The commander's colours alone are not a
 * search: they narrow every search, but browsing on them alone filled the panel whenever the box was emptied, with
 * cards that looked like results for the last letter left in it.
 */
const searchable = (q: Query) => q.name.length >= MIN_NAME_CHARS || q.cardType !== undefined || q.manaValue !== undefined;

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        pressed ? "border-primary/50 bg-primary/15 text-primary" : "border-seam text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Finds cards to put in the deck: a name, a card type and a mana value, always within the commander's colours. With no
 * name it browses the filtered cards by how widely Commander decks play them, which is how a deck gets its lands.
 *
 * Requests go out from the controls' own handlers, a short pause after the last change. A newer search aborts the one
 * before it and a counter drops any answer that still arrives, and the cards already found stay on screen, dimmed,
 * until the next set is ready to take their place.
 */
export function CardSearchPanel({ builder, colorIdentity }: { builder: DeckBuilderState; colorIdentity: string | undefined }) {
  const [query, setQuery] = useState<Query>({ name: "", cardType: undefined, manaValue: undefined });
  const [text, setText] = useState("");
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [searching, setSearching] = useState(false);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The call in flight, so a newer search can stop it rather than just ignore what it eventually says. */
  const inFlight = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  async function search(q: Query, offset: number) {
    const id = ++request.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setSearching(true);
    const r = await getApis().catalog.searchCards(
      {
        q: q.name.length >= MIN_NAME_CHARS ? q.name : "",
        limit: PAGE_SIZE,
        offset,
        ...(colorIdentity !== undefined ? { colorIdentity } : {}),
        ...(q.cardType ? { cardType: q.cardType } : {}),
        ...(q.manaValue !== undefined ? { manaValue: q.manaValue } : {}),
      },
      { signal: controller.signal },
    );
    // A superseded search says nothing: it was aborted, so its answer is either stale or the abort itself.
    if (id !== request.current) return;
    inFlight.current = null;
    setSearching(false);
    if (!r.ok) {
      setResults({ status: "error", message: r.error.message });
      return;
    }
    setResults((prev) => ({
      status: "ready",
      cards: offset > 0 && prev.status === "ready" ? [...prev.cards, ...r.data] : r.data,
      more: r.data.length === PAGE_SIZE,
    }));
  }

  function change(next: Partial<Query>) {
    const q: Query = { ...query, ...next };
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (!searchable(q)) {
      request.current++;
      inFlight.current?.abort();
      inFlight.current = null;
      setSearching(false);
      setResults({ status: "idle" });
      return;
    }
    timer.current = setTimeout(() => void search(q, 0), SEARCH_DEBOUNCE_MS);
  }

  const commanderCount = builder.deck.commanders.length;
  /** Cards on screen right now. While they are there, a search in flight dims them rather than taking them away. */
  const showing = results.status === "ready" && results.cards.length > 0 ? results.cards : null;

  return (
    <section aria-label="Add cards" className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Card name"
          placeholder="Search by card name"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            change({ name: e.target.value.trim() });
          }}
          className="bg-sleeve pl-9 text-base sm:text-sm"
        />
      </div>
      <div role="group" aria-label="Card type" className="flex flex-wrap gap-1.5">
        <Pill pressed={query.cardType === undefined} onClick={() => change({ cardType: undefined })}>
          All types
        </Pill>
        {TYPES.map((t) => (
          <Pill key={t} pressed={query.cardType === t} onClick={() => change({ cardType: query.cardType === t ? undefined : t })}>
            {cardCategoryLabel[t]}
          </Pill>
        ))}
      </div>
      <div role="group" aria-label="Mana value" className="flex flex-wrap gap-1.5">
        <Pill pressed={query.manaValue === undefined} onClick={() => change({ manaValue: undefined })}>
          Any cost
        </Pill>
        {MANA_VALUES.map((mv) => (
          <Pill key={mv} pressed={query.manaValue === mv} onClick={() => change({ manaValue: query.manaValue === mv ? undefined : mv })}>
            {mv === CURVE_TOP_MANA_VALUE ? `${mv}+` : mv}
          </Pill>
        ))}
      </div>

      {results.status === "idle" && !searching && (
        <p className="text-sm text-muted-foreground">
          {colorIdentity === undefined
            ? "Type a card name, or pick a type or a cost to browse."
            : "Type a card name, or pick a type or a cost to browse what decks in these colours play most."}
        </p>
      )}
      {/* Only when there is nothing to keep showing; otherwise the grid itself reports it with aria-busy. */}
      {searching && showing === null && (
        <p role="status" className="text-sm text-muted-foreground">
          Searching…
        </p>
      )}
      {results.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {results.message}
        </p>
      )}
      {results.status === "ready" && results.cards.length === 0 && !searching && (
        <p className="text-sm text-muted-foreground">No cards in this deck&apos;s colours match. Try fewer filters.</p>
      )}
      {showing !== null && (
        <>
          <ul
            aria-label="Search results"
            aria-busy={searching}
            className={cn(
              "grid grid-cols-3 gap-x-2 gap-y-4 transition-opacity sm:grid-cols-4 lg:grid-cols-3",
              searching && "opacity-60",
            )}
          >
            {showing.map((card) => {
              const addable = canAdd(builder.deck, card);
              const legendary = isLegendaryCreature(card) && !builder.deck.commanders.includes(card.id);
              return (
                <li key={card.id} className="flex min-w-0 flex-col gap-1">
                  <ZoomableCard card={card}>
                    <CardImage card={card} variant="small" alt="" sizes="(min-width: 1024px) 120px, 30vw" className={cn(!addable && "opacity-50")} />
                  </ZoomableCard>
                  <span className="line-clamp-2 text-[0.8125rem] leading-tight font-bold">{displayName(card)}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={addable ? "default" : "outline"}
                    disabled={!addable}
                    aria-label={addable ? `Add ${card.name}` : `${card.name} is in the deck`}
                    onClick={() => builder.add(card)}
                    className="h-8"
                  >
                    {addable ? (
                      <>
                        <Plus aria-hidden className="size-4" /> Add
                      </>
                    ) : (
                      "In deck"
                    )}
                  </Button>
                  {legendary && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Make ${card.name} the commander`}
                      onClick={() => builder.makeCommander(card, "replace")}
                      className="h-7 text-xs"
                    >
                      <Crown aria-hidden className="size-3.5" /> Commander
                    </Button>
                  )}
                  {legendary && commanderCount === 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Add ${card.name} as a second commander`}
                      onClick={() => builder.makeCommander(card, "partner")}
                      className="h-7 text-xs"
                    >
                      Partner
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {results.status === "ready" && results.more && (
            <Button type="button" variant="outline" disabled={searching} onClick={() => void search(query, showing.length)}>
              More cards
            </Button>
          )}
        </>
      )}
    </section>
  );
}
