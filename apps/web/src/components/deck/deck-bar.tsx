"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { Bracket, DeckAnalysis, RecContext } from "@mtg/core/contract";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayName } from "@/lib/cards";
import { DECK_BAR_HEIGHT_VAR } from "@/lib/constants";
import { bracketLabel, collectionModeLabel } from "@/lib/labels";
import { ColorIdentity } from "./color-identity";
import type { CollectionMode } from "./use-deck-tool";

const BRACKETS: Bracket[] = [1, 2, 3, 4, 5];
const COLLECTION_MODES: CollectionMode[] = ["first", "only", "off"];

/**
 * Sticky summary of the deck being analyzed: who it's built around, and the two knobs that change recommendations
 * (bracket and collection) on the right. Kept to two lines so the swipe view below it has the screen on a phone.
 * Game Changers follow the bracket (`defaultIncludeGameChangers`), so they have no control of their own.
 */
export function DeckBar({
  analysis,
  context,
  cardCount,
  onBracketChange,
  collectionMode,
  onCollectionModeChange,
  onEditDecklist,
}: {
  analysis: DeckAnalysis;
  context: RecContext;
  cardCount: number;
  onBracketChange: (bracket: Bracket) => void;
  /** null when there's no saved collection; the bar then links to the collection import. */
  collectionMode: CollectionMode | null;
  onCollectionModeChange: (mode: CollectionMode) => void;
  /** Opens the decklist box. Left out while the box is already open. */
  onEditDecklist?: (() => void) | undefined;
}) {
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

  const name = commanders.map(displayName).join(" and ");

  return (
    <div
      ref={bar}
      data-deck-bar=""
      className="sticky top-0 z-30 -mx-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-seam bg-background/95 px-4 py-1.5 backdrop-blur-sm"
    >
      {art ? (
        <Image
          src={art}
          alt=""
          width={96}
          height={70}
          unoptimized
          className="row-span-2 h-12 w-16 shrink-0 rounded-md object-cover ring-1 ring-seam"
        />
      ) : (
        <span className="row-span-2" />
      )}
      <h2 className="truncate font-heading text-xl leading-tight font-extrabold tracking-tight">
        {analysis.commanderKey.slug && analysis.commanderKey.deckCount > 0 ? (
          <Link
            href={`/commander/${analysis.commanderKey.slug}`}
            className="underline decoration-seam decoration-2 underline-offset-4 hover:decoration-primary"
          >
            {name}
          </Link>
        ) : (
          name
        )}
      </h2>
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
      <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <ColorIdentity identity={analysis.colorIdentity} />
        <span className="tabular-nums">{cardCount} cards</span>
        {onEditDecklist && (
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Edit decklist" title="Edit decklist" onClick={onEditDecklist}>
            <Pencil aria-hidden className="size-3.5" />
          </Button>
        )}
      </p>
      {collectionMode === null ? (
        <Link href="/collection/import" className="justify-self-end text-xs font-bold text-primary underline-offset-4 hover:underline">
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
