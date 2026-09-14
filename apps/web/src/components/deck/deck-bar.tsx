"use client";

import Image from "next/image";
import Link from "next/link";
import type { Bracket, DeckAnalysis, RecContext } from "@mtg/core/contract";
import { displayName } from "@/lib/cards";
import { ColorIdentity } from "./color-identity";
import { DeckControls } from "./deck-controls";

/** Sticky summary of the deck being analyzed: who it's built around and the knobs that change recommendations. */
export function DeckBar({
  analysis,
  context,
  cardCount,
  onBracketChange,
  onIncludeGameChangersChange,
}: {
  analysis: DeckAnalysis;
  context: RecContext;
  cardCount: number;
  onBracketChange: (bracket: Bracket) => void;
  onIncludeGameChangersChange: (include: boolean) => void;
}) {
  const commanders = analysis.commanderKey.commanders;
  const art = commanders[0]?.images?.front.artCrop;

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-seam bg-background/95 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {art && (
          <Image
            src={art}
            alt=""
            width={96}
            height={70}
            unoptimized
            className="h-12 w-16 shrink-0 rounded-md object-cover ring-1 ring-seam"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-2xl leading-tight font-extrabold tracking-tight">
            {analysis.commanderKey.slug && analysis.commanderKey.deckCount > 0 ? (
              <Link
                href={`/commander/${analysis.commanderKey.slug}`}
                className="underline decoration-seam decoration-2 underline-offset-4 hover:decoration-primary"
              >
                {commanders.map(displayName).join(" and ")}
              </Link>
            ) : (
              commanders.map(displayName).join(" and ")
            )}
          </h2>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ColorIdentity identity={analysis.colorIdentity} />
            <span>{cardCount} cards</span>
          </p>
        </div>
      </div>
      <div className="mt-3">
        <DeckControls
          bracket={context.bracket}
          bracketSource={context.bracketSource}
          estimatedBracket={analysis.estimatedBracket}
          gameChangerCount={analysis.gameChangerIds.length}
          includeGameChangers={context.includeGameChangers}
          onBracketChange={onBracketChange}
          onIncludeGameChangersChange={onIncludeGameChangersChange}
        />
      </div>
    </div>
  );
}
