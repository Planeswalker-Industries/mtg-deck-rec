"use client";

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import type { CardSet } from "@mtg/core/contract";
import {
  COLLECTION_GROUP_LABELS,
  COLLECTION_GROUPS,
  collectionGroup,
  majorSetsNewestFirst,
  MANA_COLORS,
  matchesColors,
  matchesSearch,
  matchesSet,
  type CollectionGroup,
  type ColorFilter,
  type ManaColor,
  type SetFilter,
} from "@mtg/core/collection";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { COLOR_NAMES, MANA_SYMBOL_URL } from "@/components/deck/color-identity";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayName } from "@/lib/cards";
import { useCollectionView, type CollectionViewItem } from "./use-collection-view";

/** The five colour wedges of the multicolour toggle, in WUBRG order, as Scryfall's own pips colour them. */
const MULTICOLOR_WEDGES = "conic-gradient(#f8f6d8 0 20%, #0e68ab 0 40%, #3a3531 0 60%, #d3202a 0 80%, #00733e 0)";
/** Size of a mana symbol inside its toggle, in px. */
const SYMBOL_PX = 28;

const ALL_SETS = "all";
const OTHER_SETS = "other";
const SET_PREFIX = "set:";

const count = (n: number) => n.toLocaleString("en-US");

function toSetFilter(value: string): SetFilter {
  if (value === OTHER_SETS) return { kind: "other" };
  if (value.startsWith(SET_PREFIX)) return { kind: "set", code: value.slice(SET_PREFIX.length) };
  return { kind: "all" };
}

export function CollectionView() {
  const view = useCollectionView();

  return (
    <div className="flex flex-col gap-5">
      {view.status === "loading" && (
        <>
          <Heading />
          <div className="flex max-w-md flex-col gap-1.5" aria-live="polite">
            <p className="text-sm font-bold tabular-nums">
              {view.total === 0 ? "Loading your collection…" : `Loading your collection: ${count(view.loaded)} of ${count(view.total)} cards`}
            </p>
            <ProgressBar value={view.total === 0 ? 0 : Math.round((view.loaded / view.total) * 100)} label="Loading your collection" />
          </div>
        </>
      )}
      {view.status === "error" && (
        <>
          <Heading />
          <p role="alert" className="text-sm text-destructive">
            {view.message}
          </p>
        </>
      )}
      {view.status === "none" && (
        <>
          <Heading />
          <div className="flex max-w-prose flex-col items-start gap-3 rounded-lg border border-seam bg-sleeve p-5">
            <h2 className="font-heading text-2xl font-extrabold tracking-tight">No collection yet</h2>
            <p className="text-muted-foreground">
              Import an export from ManaBox, Moxfield, Archidekt or TCGplayer to browse your cards here, and let the deck tool suggest only
              cards you own.
            </p>
            <Link href="/collection/import" className={buttonVariants({ size: "lg" })}>
              Import your collection
            </Link>
          </div>
        </>
      )}
      {view.status === "ready" && <ReadyView items={view.items} sets={view.sets} where={view.where} />}
    </div>
  );
}

function Heading() {
  return <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">My collection</h1>;
}

function ReadyView({ items, sets, where }: { items: CollectionViewItem[]; sets: CardSet[]; where: "browser" | "account" }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [colors, setColors] = useState<ColorFilter>({ colors: new Set(), colorless: false, multicolor: false });
  const [setValue, setSetValue] = useState(ALL_SETS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<CollectionGroup>>(new Set());

  const majorSets = useMemo(() => majorSetsNewestFirst(sets), [sets]);
  const majorCodes = useMemo(() => new Set(majorSets.map((s) => s.code)), [majorSets]);
  const hasOtherSets = useMemo(() => items.some((i) => i.setCodes.some((code) => !majorCodes.has(code))), [items, majorCodes]);

  const groups = useMemo(() => {
    const setFilter = toSetFilter(setValue);
    const byGroup = new Map<CollectionGroup, CollectionViewItem[]>();
    for (const item of items) {
      if (!matchesColors(item.card.colorIdentity, colors)) continue;
      if (!matchesSet(item.setCodes, setFilter, majorCodes)) continue;
      if (!matchesSearch(displayName(item.card), item.tags, deferredQuery)) continue;
      const group = collectionGroup(item.card.typeLine);
      const inGroup = byGroup.get(group);
      if (inGroup) inGroup.push(item);
      else byGroup.set(group, [item]);
    }
    return COLLECTION_GROUPS.flatMap((group) => {
      const inGroup = byGroup.get(group);
      return inGroup ? [{ group, items: inGroup.toSorted((a, b) => displayName(a.card).localeCompare(displayName(b.card))) }] : [];
    });
  }, [items, colors, setValue, majorCodes, deferredQuery]);

  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const copies = items.reduce((n, i) => n + i.quantity, 0);
  const filtering = query.trim() !== "" || colors.colors.size > 0 || colors.colorless || colors.multicolor || setValue !== ALL_SETS;

  function clearFilters() {
    setQuery("");
    setColors({ colors: new Set(), colorless: false, multicolor: false });
    setSetValue(ALL_SETS);
  }

  function toggleColor(color: ManaColor) {
    setColors((prev) => {
      const next = new Set(prev.colors);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return { ...prev, colors: next };
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">My collection</h1>
          <p className="mt-2 text-muted-foreground tabular-nums">
            {count(items.length)} different cards, {count(copies)} copies.{" "}
            {where === "account" ? "Saved to your account." : "Saved in this browser."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/collection/import" className={buttonVariants({ variant: "outline" })}>
            Import
          </Link>
          <Link href="/deck" className={buttonVariants()}>
            Use in the deck tool
          </Link>
        </div>
      </div>

      <div
        role="search"
        aria-label="Filter your collection"
        // Pinned while scrolling from sm up. On a phone the panel is a third of the screen, so it scrolls away with the page.
        className="z-20 -mx-4 flex flex-col gap-3 border-y border-seam bg-sleeve/95 px-4 py-3 backdrop-blur-sm sm:sticky sm:top-0 sm:mx-0 sm:rounded-lg sm:border"
      >
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or what it does"
            aria-label="Search your collection by card name or what it does"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Colors" className="flex flex-wrap gap-1.5">
            {MANA_COLORS.map((color) => (
              <ColorToggle key={color} label={COLOR_NAMES[color] ?? color} on={colors.colors.has(color)} onToggle={() => toggleColor(color)}>
                <Image src={MANA_SYMBOL_URL(color)} alt="" width={SYMBOL_PX} height={SYMBOL_PX} unoptimized className="size-7" />
              </ColorToggle>
            ))}
            <ColorToggle label="Colorless" on={colors.colorless} onToggle={() => setColors((p) => ({ ...p, colorless: !p.colorless }))}>
              <Image src={MANA_SYMBOL_URL("C")} alt="" width={SYMBOL_PX} height={SYMBOL_PX} unoptimized className="size-7" />
            </ColorToggle>
            <ColorToggle
              label="Multicolor: only cards with every selected color"
              on={colors.multicolor}
              onToggle={() => setColors((p) => ({ ...p, multicolor: !p.multicolor }))}
            >
              <span aria-hidden className="size-7 rounded-full ring-1 ring-black/40" style={{ background: MULTICOLOR_WEDGES }} />
            </ColorToggle>
          </div>
          <Select value={setValue} onValueChange={setSetValue}>
            <SelectTrigger aria-label="Set" className="w-full bg-background sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SETS}>All sets</SelectItem>
              {majorSets.length > 0 && <SelectSeparator />}
              {majorSets.map((s) => (
                <SelectItem key={s.code} value={`${SET_PREFIX}${s.code}`}>
                  {s.name}
                </SelectItem>
              ))}
              {hasOtherSets && (
                <>
                  <SelectSeparator />
                  <SelectItem value={OTHER_SETS}>Promos, Secret Lair and other printings</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {filtering ? `Showing ${count(shown)} of ${count(items.length)} cards.` : `${count(items.length)} cards.`}
          {filtering && (
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-6">
          <p>No cards in your collection match those filters.</p>
          <Button type="button" variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        groups.map(({ group, items: groupItems }) => {
          const open = !collapsed.has(group);
          const id = `collection-${group}`;
          return (
            <section key={group} aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
              <h2 id={`${id}-heading`}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={id}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    })
                  }
                  className="flex items-baseline gap-2 rounded-md font-heading text-2xl font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <ChevronDown aria-hidden className={cn("size-5 self-center transition-transform", !open && "-rotate-90")} />
                  {COLLECTION_GROUP_LABELS[group]}
                  <span className="font-sans text-base font-normal text-muted-foreground tabular-nums">{count(groupItems.length)}</span>
                </button>
              </h2>
              {open && (
                <div id={id}>
                  <PocketGrid
                    zoomable
                    label={COLLECTION_GROUP_LABELS[group]}
                    items={groupItems.map((item) => ({
                      card: item.card,
                      href: `/card/${item.card.slug}`,
                      caption: item.quantity > 1 ? <span className="tabular-nums text-muted-foreground">×{item.quantity}</span> : undefined,
                    }))}
                  />
                </div>
              )}
            </section>
          );
        })
      )}
    </>
  );
}

/** A colour filter toggle: dimmed while off, lit when on. */
function ColorToggle({ label, on, onToggle, children }: { label: string; on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "flex size-10 items-center justify-center rounded-full transition-opacity",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        on ? "opacity-100" : "opacity-35 hover:opacity-60",
      )}
    >
      {children}
    </button>
  );
}
