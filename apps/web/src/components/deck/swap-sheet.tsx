"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { CardSummary, SwapSuggestion, TagMatch } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { FlippableCardImage } from "@/components/cards/flippable-card-image";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/cards";
import { describeCostDelta, formatAsOf, formatPercent } from "@/lib/format";
import { emptySwapMessage } from "@/lib/labels";
import { GameChangerBadge, OwnedBadge } from "./card-label";
import { PanelError } from "./panel-state";
import type { SwapState } from "./use-deck-tool";

function jobLabels(matches: TagMatch[]): string[] {
  const labels = matches.map((m) => (m.distance === 0 || !m.via ? m.candidateTag.label : `${m.via.label} (${m.candidateTag.label})`));
  return [...new Set(labels)];
}

export function SwapSheet({
  swap,
  target,
  commanderCount,
  onClose,
}: {
  swap: SwapState | null;
  target: CardSummary | null;
  /** How many commanders lead the deck, for wording play-rate evidence. */
  commanderCount: number;
  onClose: () => void;
}) {
  return (
    <Sheet open={swap !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-xl gap-0 overflow-y-auto rounded-t-2xl border-seam bg-sleeve p-0"
      >
        {/* Keyed by target so the chosen replacement resets when another card is opened. */}
        {swap && <SwapBody key={swap.targetCardId} swap={swap} target={target} commanderCount={commanderCount} />}
      </SheetContent>
    </Sheet>
  );
}

function SwapBody({ swap, target, commanderCount }: { swap: SwapState; target: CardSummary | null; commanderCount: number }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { result } = swap;
  const targetCard = result.status === "ready" ? result.data.target : target;
  const suggestions = result.status === "ready" ? result.data.suggestions : [];
  const selected = suggestions[selectedIndex] ?? suggestions[0] ?? null;

  return (
    <>
      <SheetHeader className="px-4 pt-5 pr-12 pb-3">
        <SheetTitle className="font-heading text-3xl leading-none font-extrabold tracking-tight">
          Replace {targetCard ? displayName(targetCard) : "this card"}
        </SheetTitle>
        <SheetDescription>Cards that do the same job, best fit first.</SheetDescription>
      </SheetHeader>

      <div className="px-4 pb-6">
        {result.status === "loading" && <ComparisonSkeleton />}
        {result.status === "error" && <PanelError message={result.message} />}
        {result.status === "ready" && !selected && (
          <p className="text-sm">{emptySwapMessage[result.data.emptyReason ?? "NO_CANDIDATES"]}</p>
        )}
        {result.status === "ready" && selected && targetCard && (
          <>
            <Comparison target={targetCard} selected={selected} commanderCount={commanderCount} />
            {suggestions.length > 1 && (
              <Alternatives suggestions={suggestions} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
            )}
            {selected.costDelta.asOf && (
              <p className="mt-4 text-xs text-muted-foreground">
                Prices are Scryfall estimates from {formatAsOf(selected.costDelta.asOf)}.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Comparison({ target, selected, commanderCount }: { target: CardSummary; selected: SwapSuggestion; commanderCount: number }) {
  const saves = selected.costDelta.usd !== null && selected.costDelta.usd < 0;
  const jobs = jobLabels(selected.matchedTags);

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] items-center gap-2 sm:gap-4">
        <figure className="min-w-0">
          <figcaption className="mb-1.5 text-xs text-muted-foreground">In your deck</figcaption>
          <FlippableCardImage card={target} sizes="(min-width: 640px) 210px, 38vw" className="opacity-75 saturate-50" />
        </figure>
        <ChevronRight aria-hidden className="size-6 text-muted-foreground" />
        <figure className="min-w-0">
          <figcaption className="mb-1.5 text-xs text-muted-foreground">Replacement</figcaption>
          <FlippableCardImage
            key={selected.card.id}
            card={selected.card}
            variant="large"
            sizes="(min-width: 640px) 320px, 56vw"
            eager
            className="shadow-[0_0_0_2px_var(--color-primary)] motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:zoom-in-95"
          />
        </figure>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-heading text-2xl leading-tight font-extrabold tracking-tight">{displayName(selected.card)}</h3>
        <p className={cn("text-lg font-bold tabular-nums", saves && "text-save")}>{describeCostDelta(selected.costDelta)}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {selected.card.gameChanger && <GameChangerBadge />}
        {selected.owned && <OwnedBadge />}
        <span className="tabular-nums">
          {!selected.corpus
            ? "No deck data yet"
            : selected.corpus.limited
              ? `New card: only ${selected.corpus.commanderDeckCount.toLocaleString("en-US")} deck${selected.corpus.commanderDeckCount === 1 ? "" : "s"} could have played it so far`
              : selected.corpus.pooled
                ? `Played in ${formatPercent(selected.corpus.inclusionRate)} of decks with ${commanderCount > 1 ? "these commanders, counting decks that share one" : "this commander, counting its other pairings"}`
                : `Played in ${formatPercent(selected.corpus.inclusionRate)} of ${selected.corpus.commanderDeckCount.toLocaleString("en-US")} decks ${selected.corpus.scope === "commander" ? "with this commander" : "in these colors"}`}
        </span>
      </div>
      {selected.functionalTwin ? (
        <p className="mt-2 text-sm font-bold text-primary">
          Same rules as {displayName(target)}, under a different name. You can run both in one deck.
        </p>
      ) : (
        jobs.length > 0 && <p className="mt-2 text-sm">Does the same job: {jobs.join(", ")}</p>
      )}
    </div>
  );
}

function Alternatives({
  suggestions,
  selectedIndex,
  onSelect,
}: {
  suggestions: SwapSuggestion[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <section aria-labelledby="swap-alternatives" className="mt-5">
      <h4 id="swap-alternatives" className="text-sm font-bold">
        Other options <span className="font-normal text-muted-foreground tabular-nums">{suggestions.length}</span>
      </h4>
      <ul className="-mx-4 mt-2 flex snap-x gap-2 overflow-x-auto px-4 pb-2">
        {suggestions.map((s, i) => (
          <li key={s.card.id} className="w-[5.5rem] shrink-0 snap-start">
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={i === selectedIndex}
              className={cn(
                "block w-full rounded-lg p-1 text-left",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                i === selectedIndex ? "bg-background ring-2 ring-primary" : "hover:bg-background",
              )}
            >
              <CardImage card={s.card} alt="" sizes="88px" />
              <span className="mt-1 line-clamp-2 text-[0.6875rem] leading-tight font-bold">{displayName(s.card)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ComparisonSkeleton() {
  return (
    <div role="status" aria-label="Finding replacements" className="grid grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)] items-center gap-2 sm:gap-4">
      <Skeleton className="aspect-[488/680] w-full rounded-[4.75%/3.4%] bg-seam" />
      <ChevronRight aria-hidden className="size-6 text-seam" />
      <Skeleton className="aspect-[488/680] w-full rounded-[4.75%/3.4%] bg-seam" />
    </div>
  );
}
