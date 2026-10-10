"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Pencil } from "lucide-react";
import type { Bracket, DeckAnalysis, RecContext } from "@mtg/core/contract";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayName } from "@/lib/cards";
import { DECK_BAR_HEIGHT_VAR, PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { bracketLabel, collectionModeLabel } from "@/lib/labels";
import { ColorIdentity } from "./color-identity";
import { DeckIssuesChip } from "./resolution-issues";
import type { CollectionMode } from "./use-deck-tool";

const BRACKETS: Bracket[] = [1, 2, 3, 4, 5];
const COLLECTION_MODES: CollectionMode[] = ["first", "only", "off"];

/**
 * The deck's name, which renames it when tapped: an input in its place, written on Enter or when focus leaves, put
 * back on Escape. A failed rename keeps the input open with the reason.
 */
function DeckName({ name, onRename }: { name: string; onRename: (name: string) => Promise<string | null> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Escape puts the name back; the blur that follows as the input goes must not write it after all. */
  const cancelled = useRef(false);

  async function commit() {
    if (draft === null || busy || cancelled.current) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(null);
      setError(null);
      return;
    }
    setBusy(true);
    const failed = await onRename(trimmed);
    setBusy(false);
    setError(failed);
    if (failed === null) setDraft(null);
  }

  if (draft === null) {
    return (
      <h2 className="min-w-0 truncate font-heading text-lg leading-tight font-semibold tracking-tight sm:text-xl">
        <button
          type="button"
          title="Rename deck"
          aria-label={`Rename deck: ${name}`}
          onClick={() => {
            cancelled.current = false;
            setDraft(name);
          }}
          className="max-w-full truncate rounded-sm text-left decoration-dotted underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {name}
        </button>
      </h2>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void commit();
      }}
    >
      <Input
        autoFocus
        aria-label="Deck name"
        value={draft}
        maxLength={MAX_DECK_NAME_CHARS}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          cancelled.current = true;
          setDraft(null);
          setError(null);
        }}
        className="h-8 bg-sleeve font-heading text-base font-semibold"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Sticky summary of the deck being analyzed: its name (tap to rename), who it's built around (the commander's art
 * opens their page), and the two knobs that change recommendations (bracket and collection) on the right. Kept to two
 * lines so the swipe view below it has the screen on a phone. Game Changers follow the bracket
 * (`defaultIncludeGameChangers`), so they have no control of their own.
 */
export function DeckBar({
  analysis,
  context,
  deckName,
  onRename,
  cardCount,
  coverage,
  onBracketChange,
  collectionMode,
  onCollectionModeChange,
  onEditDecklist,
  saveSlot,
  collectionImportHref = "/collection/import?next=/deck",
}: {
  analysis: DeckAnalysis;
  context: RecContext;
  /** What the deck is called: the open deck's name, one the player gave it, or its commanders'. */
  deckName: string;
  /** Renames the deck; resolves to an error message, or null when it worked. */
  onRename: (name: string) => Promise<string | null>;
  cardCount: number;
  /** Upgrade's current deck coverage; replaces the count on the existing second line. */
  coverage?: ReactNode;
  onBracketChange: (bracket: Bracket) => void;
  /** null when there's no saved collection; the bar then links to the collection import. */
  collectionMode: CollectionMode | null;
  onCollectionModeChange: (mode: CollectionMode) => void;
  /** Opens the decklist box. Left out while the box is already open. */
  onEditDecklist?: (() => void) | undefined;
  /**
   * The Deckbuilder's bar: the colours move up beside the name, the card count goes (the builder's stats line has it),
   * and this (Save deck) takes the collection select's place, which moves into the builder's search panel.
   */
  saveSlot?: ReactNode;
  /** Return to the initiating deck after a successful collection import. */
  collectionImportHref?: Route;
}) {
  const building = saveSlot !== undefined;
  const phoneCoverage = !building && coverage !== undefined;
  const commanders = analysis.commanderKey.commanders;
  const art = commanders[0]?.images?.front.artCrop;
  const bar = useRef<HTMLDivElement>(null);

  // Sticky surfaces below the bar read its height from a CSS variable, since the bar's height changes with the
  // commander's name and the controls wrapping. Removed on unmount, so pages without the bar fall back to 0.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(DECK_BAR_HEIGHT_VAR, `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(DECK_BAR_HEIGHT_VAR);
    };
  }, []);

  const commanderName = commanders.map(displayName).join(" and ");
  const { slug, deckCount } = analysis.commanderKey;
  const commanderPage = slug && deckCount > 0 ? (`/commander/${slug}` as Route) : null;
  const artImage = art ? (
    <Image src={art} alt="" width={96} height={70} unoptimized className={cn("h-12 w-16 shrink-0 rounded-md object-cover ring-1 ring-seam", phoneCoverage && "max-sm:h-7")} />
  ) : null;

  return (
    <div
      ref={bar}
      data-deck-bar=""
      className="sticky top-0 z-30 -mx-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-seam bg-background/95 px-4 py-1.5 backdrop-blur-sm"
    >
      {/* The commander's art leads to their page, when they have one; the name beside it is the deck's, and renames it. */}
      {artImage && commanderPage ? (
        <Link
          href={commanderPage}
          aria-label={`${commanderName}: commander page`}
          title={`${commanderName}: commander page`}
          className={cn("row-span-2 rounded-md transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", phoneCoverage && `${PHONE_HIT_AREA} max-sm:row-span-1`)}
        >
          {artImage}
        </Link>
      ) : (
        <span className={cn("row-span-2", phoneCoverage && "max-sm:row-span-1")}>{artImage}</span>
      )}
      {/* The deck's issues sit beside the name as a chip, on every screen; in the Deckbuilder the colours come first. */}
      <div className="flex min-w-0 items-center gap-2">
        <DeckName key={deckName} name={deckName} onRename={onRename} />
        {building && <ColorIdentity identity={analysis.colorIdentity} className="shrink-0" />}
        <DeckIssuesChip issues={analysis.issues} />
      </div>
      <Select value={String(context.bracket)} onValueChange={(value) => onBracketChange(Number(value) as Bracket)}>
        <SelectTrigger aria-label="Bracket" size="sm" className="justify-self-end bg-sleeve">
          {/* The trigger says which bracket in a few characters; the list spells each one out. */}
          <SelectValue>Bracket {context.bracket}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {BRACKETS.map((b) => (
            <SelectItem key={b} value={String(b)}>
              {bracketLabel[b]}
              {b === analysis.estimatedBracket ? " (estimated)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Coverage uses the space below the art on phones, without adding a third line. */}
      <p className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", phoneCoverage && "max-sm:col-span-2")}>
        {!building && (
          <>
            <ColorIdentity identity={analysis.colorIdentity} className={phoneCoverage ? "max-sm:min-w-0" : undefined} />
            {coverage ?? <span className="font-mono">{cardCount} cards</span>}
          </>
        )}
        {onEditDecklist && (
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Edit decklist" title="Edit decklist" onClick={onEditDecklist}>
            <Pencil aria-hidden className="size-3.5" />
          </Button>
        )}
      </p>
      {building ? (
        <div className="justify-self-end">{saveSlot}</div>
      ) : collectionMode === null ? (
        <Link href={collectionImportHref} className={cn(TEXT_LINK, "justify-self-end text-xs font-semibold")}>
          Add collection
        </Link>
      ) : (
        <Select value={collectionMode} onValueChange={(value) => onCollectionModeChange(value as CollectionMode)}>
          <SelectTrigger aria-label="My collection" size="sm" className="justify-self-end bg-sleeve">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {COLLECTION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {collectionModeLabel[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
