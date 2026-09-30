"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownAZ, ArrowDownZA, Crown, Plus, Search, X } from "lucide-react";
import type { CardSearchSort, CardSummary, CardTypeFilter, OwnershipInput } from "@mtg/core/contract";
import { canAdd, CURVE_TOP_MANA_VALUE } from "@mtg/core/journey";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CollectionMode } from "@/components/deck/use-deck-tool";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";
import { cardCategoryLabel } from "@/lib/labels";
import { TEXT_LINK } from "@/lib/constants";
import { BasicLandButtons } from "./basic-land-buttons";
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

/** The type pips, in the order a player scans for them. Legendary is a supertype, but it narrows like the rest. */
const TYPES: CardTypeFilter[] = ["legendary", "creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "land", "battle"];
const TYPE_LABELS: Record<CardTypeFilter, string> = { ...cardCategoryLabel, legendary: "Legendary" };

/**
 * The collection, as the search panel sees it: whether results are limited to owned cards. Owned only is the deck
 * tool's "only" setting, so it limits the replacements too; All cards puts it back to owned first. `mode` is null
 * when there is no collection to limit by.
 */
export interface BuilderCollection {
  mode: CollectionMode | null;
  onChange: (mode: CollectionMode) => void;
  /** Sent with every search while Owned only is on. */
  ownedOnly?: OwnershipInput | undefined;
}
const MANA_VALUES = Array.from({ length: CURVE_TOP_MANA_VALUE + 1 }, (_, i) => i);

/**
 * A row of pills: one line that scrolls sideways only below `sm` (phones), so the stuck filter block stays short
 * enough to leave room for results; wrapped from `sm` up, where there's enough width to show every pill without
 * needing a mouse-hostile sideways scroll (a tablet or a narrow desktop window has neither the touch gesture nor the
 * `lg` sidebar layout to make the scrolling row usable). `py-1 -my-1` gives the scrolling row's focus ring room so
 * `overflow-x-auto` doesn't clip it top and bottom, without changing the row's outer height.
 */
const PILL_ROW =
  "-mx-4 flex gap-1.5 overflow-x-auto px-4 py-1 -my-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";

/**
 * What the panel asks for. Types narrow (a card must carry every one picked: creature and artifact is artifact
 * creatures); costs widen (any one picked). An empty list is the All types or Any cost pill.
 */
interface Query {
  name: string;
  cardTypes: CardTypeFilter[];
  manaValues: number[];
  /** Results are always alphabetical; the button flips the direction. */
  sort: CardSearchSort;
}

/** The list with `value` added, or taken out when it was already in: a pill is a toggle. */
const toggled = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

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
const searchable = (q: Query) => q.name.length >= MIN_NAME_CHARS || q.cardTypes.length > 0 || q.manaValues.length > 0;

function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        pressed
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-seam text-muted-foreground hover:border-primary/50 hover:text-primary focus-visible:text-primary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Owned only or all cards, for a player with a collection; a link to import one for a player without. It is the deck
 * tool's collection setting, so it limits the replacements too.
 */
function CollectionFilter({ collection }: { collection: BuilderCollection }) {
  if (collection.mode === null) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href="/collection/import" className={cn(TEXT_LINK, "font-semibold")}>
          Add your collection
        </Link>{" "}
        to search only the cards you own.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span id="builder-collection-label" className="text-muted-foreground">
        Show
      </span>
      <Select value={collection.mode === "only" ? "only" : "all"} onValueChange={(value) => collection.onChange(value === "only" ? "only" : "first")}>
        <SelectTrigger aria-labelledby="builder-collection-label" size="sm" className="bg-sleeve">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="all">All cards</SelectItem>
          <SelectItem value="only">Owned only</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Finds cards to put in the deck: card types (all of them), mana values (any of them) and a name, always within the
 * commander's colours, alphabetical either way, and limited to owned cards when the player asks. A deck with no
 * commander yet searches commanders only. With no name, a type or cost pill browses; the commander's colours alone
 * are not a search, so an empty box with no pill shows nothing.
 *
 * Requests go out from the controls' own handlers, a short pause after the last change. A newer search aborts the one
 * before it and a counter drops any answer that still arrives, and the cards already found stay on screen, dimmed,
 * until the next set is ready to take their place.
 */
export function CardSearchPanel({
  builder,
  colorIdentity,
  collection,
}: {
  builder: DeckBuilderState;
  colorIdentity: string | undefined;
  collection?: BuilderCollection | undefined;
}) {
  const [query, setQuery] = useState<Query>({ name: "", cardTypes: [], manaValues: [], sort: "name_asc" });
  const [text, setText] = useState("");
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [searching, setSearching] = useState(false);
  const request = useRef(0);
  /** The search waiting out the typing pause; null once it has gone (or there is none). */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The name box, which takes focus back after an add or Clear so the next card can be typed straight away. */
  const box = useRef<HTMLInputElement>(null);
  /** The call in flight, so a newer search can stop it rather than just ignore what it eventually says. */
  const inFlight = useRef<AbortController | null>(null);
  /**
   * The commander's colours as of the latest render. A search waits out the typing pause, and the commander can change
   * in the meantime (the Commander button on a result), so it reads them when it goes out.
   */
  const identityRef = useRef(colorIdentity);
  const searchedIdentity = useRef(colorIdentity);
  /** Read when a search goes out, like the colours: Owned only and the commander can change during the pause. */
  const ownedOnly = collection?.ownedOnly;
  const ownedRef = useRef(ownedOnly);
  // The ownership object is rebuilt on every render of the tool, so a change is told by this key, not by identity.
  const ownedKey = ownedOnly === undefined ? "" : ownedOnly.kind === "session" ? `session:${ownedOnly.ownedCardIds.length}` : "account";
  const searchedOwned = useRef(ownedKey);
  /** A deck with no commander yet searches commanders only, so the first card picked can lead it. */
  const commanderless = builder.deck.commanders.length === 0;
  const commanderlessRef = useRef(commanderless);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  async function search(q: Query, offset: number) {
    const colorIdentity = identityRef.current;
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
        sort: q.sort,
        ...(commanderlessRef.current ? { commanderEligible: true } : {}),
        ...(ownedRef.current ? { ownedOnly: ownedRef.current } : {}),
        ...(colorIdentity !== undefined ? { colorIdentity } : {}),
        ...(q.cardTypes.length > 0 ? { cardTypes: q.cardTypes } : {}),
        ...(q.manaValues.length > 0 ? { manaValues: q.manaValues } : {}),
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

  // A new commander means new colours: the results on screen were found for the old ones, so the search runs again,
  // after the same pause as typing. An effect because the colours change with the deck, which the builder owns, not
  // with anything this panel handles.
  useEffect(() => {
    identityRef.current = colorIdentity;
    ownedRef.current = ownedOnly;
    commanderlessRef.current = commanderless;
    if (searchedIdentity.current === colorIdentity && searchedOwned.current === ownedKey) return;
    searchedIdentity.current = colorIdentity;
    searchedOwned.current = ownedKey;
    if (!searchable(query)) return;
    schedule(query);
    // Keyed on the colours and the collection: a query change searches from its own handler. A commander appearing or
    // leaving changes the colours too, so commander-only follows along.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorIdentity, ownedKey, commanderless]);

  /** Runs a search after the typing pause, replacing one still waiting. */
  function schedule(q: Query) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void search(q, 0);
    }, SEARCH_DEBOUNCE_MS);
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
    schedule(q);
  }

  /** Empties the box and lifts both filters, which also drops the results and any search still waiting. */
  function clear() {
    setText("");
    change({ name: "", cardTypes: [], manaValues: [] });
    box.current?.focus();
  }

  /**
   * Puts a card in the deck, then empties the name box and hands it focus again, for a player typing their list in one
   * card after another. The type and cost pills stay as they are.
   */
  function addCard(card: CardSummary) {
    builder.add(card);
    setText("");
    change({ name: "" });
    box.current?.focus();
  }

  /**
   * Enter adds the only card a search found. With several results it does nothing: which one was meant is the
   * player's call. A search still waiting out the typing pause goes now instead, so the next Enter can add.
   */
  function onEnter() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void search(query, 0);
      return;
    }
    if (searching || results.status !== "ready" || results.more || results.cards.length !== 1) return;
    const [only] = results.cards;
    if (only && canAdd(builder.deck, only)) addCard(only);
  }

  const nextSort: CardSearchSort = query.sort === "name_asc" ? "name_desc" : "name_asc";
  const sortLabel = { name_asc: "A to Z", name_desc: "Z to A" } as const;

  const commanderCount = builder.deck.commanders.length;
  /** Cards on screen right now. While they are there, a search in flight dims them rather than taking them away. */
  const showing = results.status === "ready" && results.cards.length > 0 ? results.cards : null;

  return (
    <section aria-label="Add cards" className="flex flex-col gap-3">
      {/*
        Stuck while the results scroll. On a phone the page scrolls, so it stops below the deck tool's sticky deck bar
        (--deck-bar-height, 0 where there is none) and bleeds to the screen edge like that bar; from lg the sidebar is
        the scroll area, so it sticks to the sidebar's top.
      */}
      <div className="sticky top-[var(--deck-bar-height,0px)] z-20 -mx-4 flex flex-col gap-2 border-b border-seam bg-background/95 px-4 py-3 backdrop-blur-sm lg:top-0 lg:mx-0 lg:rounded-lg lg:border lg:bg-background lg:px-3 lg:pt-3">
        <div role="group" aria-label="Card type" className={PILL_ROW}>
          <Pill pressed={query.cardTypes.length === 0} onClick={() => change({ cardTypes: [] })}>
            All
          </Pill>
          {TYPES.map((t) => (
            <Pill key={t} pressed={query.cardTypes.includes(t)} onClick={() => change({ cardTypes: toggled(query.cardTypes, t) })}>
              {TYPE_LABELS[t]}
            </Pill>
          ))}
        </div>
        <div role="group" aria-label="Mana value" className={PILL_ROW}>
          <Pill pressed={query.manaValues.length === 0} onClick={() => change({ manaValues: [] })}>
            All
          </Pill>
          {MANA_VALUES.map((mv) => (
            <Pill key={mv} pressed={query.manaValues.includes(mv)} onClick={() => change({ manaValues: toggled(query.manaValues, mv) })}>
              {mv === CURVE_TOP_MANA_VALUE ? `${mv}+` : mv}
            </Pill>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={box}
              type="search"
              aria-label="Card name"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onEnter();
              }}
              placeholder={commanderless ? "Search for a commander" : "Search by card name"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                change({ name: e.target.value.trim() });
              }}
              className="bg-sleeve pl-9 text-base sm:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          {/* Results are always alphabetical; this flips the direction, and the label says which way it runs now. */}
          <Button
            type="button"
            variant="outline"
            aria-label={`Sorted ${sortLabel[query.sort]}. Sort ${sortLabel[nextSort]}`}
            title={`Sort ${sortLabel[nextSort]}`}
            onClick={() => change({ sort: nextSort })}
            className="shrink-0 font-mono"
          >
            {query.sort === "name_asc" ? <ArrowDownAZ aria-hidden /> : <ArrowDownZA aria-hidden />}
            {query.sort === "name_asc" ? "A–Z" : "Z–A"}
          </Button>
          {/* Clears the name and both filters at once; the browser's own clear cross only emptied the box. */}
          {(text !== "" || query.cardTypes.length > 0 || query.manaValues.length > 0) && (
            <Button type="button" variant="ghost" onClick={clear} className="shrink-0 text-muted-foreground">
              <X aria-hidden /> Clear
            </Button>
          )}
        </div>
        {/* The collection on the left, the commander's basic lands on the right, one row. */}
        <div className="flex flex-wrap items-center gap-2">
          {collection && <CollectionFilter collection={collection} />}
          <BasicLandButtons identity={colorIdentity} onAdd={(land) => builder.add(land)} />
        </div>
      </div>

      {results.status === "idle" && !searching && (
        <p className="text-sm text-muted-foreground">
          {commanderless
            ? "Pick a commander first: type a name, or pick a type or a cost to browse cards that can lead a deck."
            : "Type a card name, or pick a type or a cost to browse cards in your commander's colours."}
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
        <p className="text-sm text-muted-foreground">
          {ownedOnly
            ? "None of the cards you own match. Try fewer filters, or show all cards."
            : "No cards in this deck's colours match. Try fewer filters."}
        </p>
      )}
      {showing !== null && (
        <>
          <ul
            aria-label="Search results"
            aria-busy={searching}
            className={cn(
              "grid grid-cols-3 gap-x-2 gap-y-4 transition-opacity sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4",
              searching && "opacity-60",
            )}
          >
            {showing.map((card) => {
              const addable = canAdd(builder.deck, card);
              const legendary = isLegendaryCreature(card) && !builder.deck.commanders.includes(card.id);
              return (
                <li key={card.id} className="flex min-w-0 flex-col gap-1">
                  {/* Click or tap only: this panel scrolls, and a hover-opened card got stuck open (see `hover`). */}
                  <ZoomableCard card={card} hover={false}>
                    <CardImage card={card} variant="small" alt="" sizes="(min-width: 1024px) 120px, 30vw" className={cn(!addable && "opacity-50")} />
                  </ZoomableCard>
                  {/* Two lines whatever the name, so the Add buttons line up across the row. */}
                  <span className="line-clamp-2 min-h-[2lh] text-sm leading-tight font-semibold">{displayName(card)}</span>
                  {addable ? (
                    <Button type="button" size="sm" aria-label={`Add ${card.name}`} onClick={() => addCard(card)} className="h-8">
                      <Plus aria-hidden className="size-4" /> Add
                    </Button>
                  ) : (
                    // A card already in the deck says so, and turns into Remove under the mouse or keyboard focus. Touch has
                    // no hover, so there it says Remove outright rather than let "In deck" take a card out.
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Remove ${card.name} from the deck`}
                      onClick={() => builder.remove(card)}
                      className="h-8 hover:border-cut/60 hover:text-cut focus-visible:text-cut [@media(hover:none)]:text-cut"
                    >
                      <span className="group-hover/button:hidden group-focus-visible/button:hidden [@media(hover:none)]:hidden">In deck</span>
                      <span className="hidden group-hover/button:inline group-focus-visible/button:inline [@media(hover:none)]:inline">
                        Remove
                      </span>
                    </Button>
                  )}
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
