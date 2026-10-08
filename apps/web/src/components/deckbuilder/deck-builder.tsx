"use client";

import { useMemo, useState } from "react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { DeckAnalysis, RecContext } from "@mtg/core/contract";
import { deckStats, isBasicLand } from "@mtg/core/journey";
import type { DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { groupHeading } from "@/components/deck/deck-group-id";
import { DeckStatsFooter } from "@/components/deck/deck-stats/deck-stats-footer";
import { DeckStatsRail } from "@/components/deck/deck-stats/deck-stats-rail";
import { useDeckStats } from "@/components/deck/deck-stats/use-deck-stats";
import { SwapSheet } from "@/components/deck/swap-sheet";
import { formatAsOf, formatUsd } from "@/lib/format";
import { CardSearchPanel, type BuilderCollection } from "./card-search-panel";
import { DeckRow } from "./deck-row";
import type { DeckBuilderState } from "./use-deck-builder";

/** Average mana value to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;

const WUBRG = "WUBRG";

/**
 * The Deck stats footer's height below `xl` (its bar, --deck-stats-dock-height in globals.css, plus the safe area), and
 * none from `xl`, where the readout is a rail. The page itself reserves the footer's room (globals.css); this is for the
 * halves below.
 */
const DECK_STATS_DOCK =
  "[--deck-stats-dock:calc(var(--deck-stats-dock-height)_+_env(safe-area-inset-bottom))] xl:[--deck-stats-dock:0px]";

/**
 * From `lg`, each half scrolls on its own inside the window, below the deck tool's sticky deck bar when there is one
 * (--deck-bar-height, set by DeckBar) and above the Deck stats footer while it docks (--deck-stats-dock), so the search
 * stays in reach however long the decklist is.
 */
const HALF_SCROLL =
  "lg:sticky lg:top-[calc(var(--deck-bar-height,0px)+1rem)] lg:max-h-[calc(100dvh-var(--deck-bar-height,0px)-var(--deck-stats-dock,0px)-2rem)] lg:overflow-y-auto lg:overscroll-contain";

/** From `xl` the Deck stats rail is a third column beside the halves. */
const WITH_STATS_RAIL = "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]";

/** Within a type, cheapest first, then by name, the order a hand of the deck would be sorted in. */
const byCost = (entries: readonly DeckEntry[]) =>
  [...entries].sort((a, b) => a.card.manaValue - b.card.manaValue || a.card.name.localeCompare(b.card.name));

/**
 * The deckbuilder: a search to add cards on the left and the deck as a list of strips on the right, by type and then
 * by cost, every card editable. On a phone the two are tabs; from `lg` up they sit side by side and scroll apart.
 *
 * `analysis` is the host's latest reading of the deck (legality, bracket, commander), used for the problems list and
 * for asking for replacements; it lags an edit by the host's debounce, which is why card counts come from the builder.
 */
export function DeckBuilder({
  builder,
  analysis,
  swapContext,
  showIssues = true,
  collection,
}: {
  builder: DeckBuilderState;
  analysis: DeckAnalysis | null;
  /** Bracket and Game Changer choice for replacements; null hides Replace until the deck has been read. */
  swapContext: RecContext | null;
  /** The deck tool lists the deck's issues above the builder already, so it turns this copy off. */
  showIssues?: boolean;
  /** The player's collection, for the search panel's Owned only choice. The deck tool has one; a saved deck's page doesn't. */
  collection?: BuilderCollection | undefined;
}) {
  const [tab, setTab] = useState<"deck" | "add">("deck");
  const stats = deckStats([...builder.commanders.map((card) => ({ card, quantity: 1 })), ...builder.main]);
  const identity = builder.commanders.length === 0 ? undefined : [...WUBRG].filter((c) => builder.commanders.some((cmd) => cmd.colorIdentity.includes(c))).join("");
  const issues = analysis?.issues ?? [];
  // builder.main is rebuilt every render, and the stats hook re-syncs on a new array: keep one array per content.
  const mainKey = builder.main.map((e) => `${e.card.id}:${e.quantity}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mainKey is builder.main's content
  const entries = useMemo(() => builder.main, [mainKey]);
  const statsReport = useDeckStats({
    analysis,
    entries,
    bracket: swapContext?.bracket ?? analysis?.estimatedBracket ?? null,
  });
  const swapTarget = builder.swap ? (builder.cards.get(builder.swap.targetCardId) ?? null) : null;

  return (
    <div className={cn("flex flex-col gap-4", statsReport && DECK_STATS_DOCK)}>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-seam bg-sleeve px-4 py-3 text-sm">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Cards</dt>
          <dd className={cn("font-mono", builder.size !== COMMANDER_DECK_SIZE && "text-cut")}>
            {builder.size} / {COMMANDER_DECK_SIZE}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Lands</dt>
          <dd className="font-mono">{stats.lands}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Average mana value</dt>
          <dd className="font-mono">{stats.averageManaValue.toFixed(MANA_VALUE_DECIMALS)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-mono">
            {formatUsd(stats.priceUsd)}
            {stats.priceAsOf && <span className="font-normal text-muted-foreground"> as of {formatAsOf(stats.priceAsOf)}</span>}
          </dd>
        </div>
      </dl>
      {showIssues && issues.length > 0 && (
        <details className="rounded-lg border border-cut/40 bg-cut/5 px-4 py-2 text-sm">
          <summary className="cursor-pointer font-semibold text-cut">
            {issues.length} deck issue{issues.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div role="group" aria-label="Show" className="inline-flex w-fit rounded-lg bg-muted p-0.5 lg:hidden">
        {(["deck", "add"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md px-4 py-1.5 text-sm font-normal transition-colors sm:min-h-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary",
            )}
          >
            {t === "deck" ? "Deck" : "Add cards"}
          </button>
        ))}
      </div>

      <div className={cn("grid grid-cols-1 items-start gap-6 lg:grid-cols-2", statsReport && WITH_STATS_RAIL)}>
        {/* Unlabelled: the panel inside is the "Add cards" region, and one landmark per job is enough. */}
        <aside className={cn(HALF_SCROLL, "min-w-0", tab === "deck" && "hidden lg:block")}>
          <CardSearchPanel builder={builder} colorIdentity={identity} collection={collection} />
        </aside>

        <section aria-label="Deck list" className={cn(HALF_SCROLL, "flex min-w-0 flex-col gap-5 lg:pr-1", tab === "add" && "hidden lg:flex")}>
          <section aria-labelledby="builder-commanders" className="flex flex-col gap-2">
            <h2 id="builder-commanders" className="font-heading text-xl leading-none font-semibold">
              Commander{builder.commanders.length > 1 ? "s" : ""}
            </h2>
            {builder.commanders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No commander yet. The search shows only cards that can lead a deck until you pick one.
              </p>
            ) : (
              <ul aria-label="Commanders" className="flex flex-col gap-1.5">
                {builder.commanders.map((card) => (
                  <DeckRow key={card.id} card={card} quantity={1} commander onRemove={() => builder.remove(card)} />
                ))}
              </ul>
            )}
          </section>
          {builder.groups.map((group) => (
            <section key={group.key} aria-label={groupHeading(group.label)} className="flex flex-col gap-2">
              <h2 className="font-heading text-xl leading-none font-semibold">
                {groupHeading(group.label)} <span className="font-mono text-sm font-normal text-muted-foreground">{group.count}</span>
              </h2>
              <ul aria-label={groupHeading(group.label)} className="flex flex-col gap-1.5">
                {byCost(group.entries).map(({ card, quantity }) => (
                  <DeckRow
                    key={card.id}
                    card={card}
                    quantity={quantity}
                    onRemove={() => builder.remove(card)}
                    onQuantity={isBasicLand(card) ? (n) => builder.setQuantity(card, n) : undefined}
                    onReplace={swapContext ? () => void builder.openSwap(card, swapContext) : undefined}
                  />
                ))}
              </ul>
            </section>
          ))}
        </section>
        {statsReport && <DeckStatsRail className="hidden xl:flex" report={statsReport} cards={builder.cards} />}
      </div>

      {statsReport && <DeckStatsFooter className="xl:hidden" dock="xl" report={statsReport} cards={builder.cards} />}

      <SwapSheet
        swap={builder.swap}
        target={swapTarget}
        commanderCount={builder.commanders.length}
        onClose={builder.closeSwap}
        onSwapIn={swapTarget ? (replacement) => builder.swapIn(swapTarget, replacement) : undefined}
      />
    </div>
  );
}
