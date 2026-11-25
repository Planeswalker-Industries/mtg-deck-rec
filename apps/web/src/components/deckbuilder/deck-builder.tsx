"use client";

import { useMemo, useState } from "react";
import type { DeckAnalysis, RecContext } from "@mtg/core/contract";
import type { DeckEntry } from "@mtg/core/scoring";
import { isBasicLand } from "@mtg/core/journey";
import { TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { byCost, groupHeading } from "@/components/deck/deck-group-id";
import { DeckStatsFooter } from "@/components/deck/deck-stats/deck-stats-footer";
import { DeckStatsRail } from "@/components/deck/deck-stats/deck-stats-rail";
import { useDeckStats } from "@/components/deck/deck-stats/use-deck-stats";
import { SwapSheet } from "@/components/deck/swap-sheet";
import { TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";
import { CardSearchPanel, type BuilderCollection } from "./card-search-panel";
import { CardPlate } from "@/components/cards/card-plate";
import type { DeckBuilderState } from "./use-deck-builder";

const WUBRG = "WUBRG";

/**
 * The Deck stats footer's height below `xl` (its bar, --deck-stats-dock-height in globals.css, plus the safe area), and
 * none from `xl`, where the readout is a rail. The page itself reserves the footer's room (globals.css); this is for the
 * halves below.
 */
const DECK_STATS_DOCK = "[--deck-stats-dock:calc(var(--deck-stats-dock-height)_+_env(safe-area-inset-bottom))] xl:[--deck-stats-dock:0px]";

/**
 * Each half is a sheet, edge to edge on phones. From `lg` it scrolls on its own inside the window, below the deck
 * tool's sticky deck bar when there is one (--deck-bar-height, set by DeckBar) and above the Deck stats footer while it
 * docks (--deck-stats-dock), so the search stays in reach however long the decklist is. The sheet is the sticky outer
 * box and HALF_SCROLL the scroll inside it: a sheet that scrolled itself would carry its paper (::before) away.
 */
const HALF_SHEET =
  "sheet max-sm:-mx-4 lg:sticky lg:top-[calc(var(--deck-bar-height,0px)+1rem)] lg:flex lg:max-h-[calc(100dvh-var(--deck-bar-height,0px)-var(--deck-stats-dock,0px)-2rem)] lg:flex-col";
const HALF_SCROLL = "min-h-0 px-4 pb-4 lg:overflow-y-auto lg:overscroll-contain";

/** From `xl` the Deck stats rail is a third column beside the halves. */
const WITH_STATS_RAIL = "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]";

/**
 * The deck as the builder opened it (for a saved deck, the version saved before this visit), for Deck stats to measure
 * the edits against. Each card carries its roles from the first analysis, which read that deck: a later analysis no
 * longer knows a card cut since. Undefined until that analysis arrives.
 */
function useOpenedDeck(main: readonly DeckEntry[], analysis: DeckAnalysis | null): readonly DeckEntry[] | undefined {
  const [opened] = useState(main);
  const [start, setStart] = useState<readonly DeckEntry[] | undefined>(undefined);
  if (start === undefined && analysis) {
    setStart(opened.map((e) => ({ ...e, card: { ...e.card, roles: e.card.roles ?? analysis.cardRoles[e.card.id] ?? [] } })));
  }
  return start;
}

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
  tour,
}: {
  /** The screen's tour id: the deck list and its first commander's plate carry `<tour>.list` and `<tour>.card`. */
  tour?: string | undefined;
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
  const identity =
    builder.commanders.length === 0
      ? undefined
      : [...WUBRG].filter((c) => builder.commanders.some((cmd) => cmd.colorIdentity.includes(c))).join("");
  const issues = analysis?.issues ?? [];
  // builder.main is rebuilt every render, and the stats hook re-syncs on a new array: keep one array per content.
  const mainKey = builder.main.map((e) => `${e.card.id}:${e.quantity}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mainKey is builder.main's content
  const entries = useMemo(() => builder.main, [mainKey]);
  const start = useOpenedDeck(builder.main, analysis);
  const statsReport = useDeckStats({
    analysis,
    entries,
    bracket: swapContext?.bracket ?? analysis?.estimatedBracket ?? null,
    start,
  });
  const swapTarget = builder.swap ? (builder.cards.get(builder.swap.targetCardId) ?? null) : null;

  return (
    <div className={cn("flex flex-col gap-4", statsReport && DECK_STATS_DOCK)}>
      {showIssues && issues.length > 0 && (
        <details className="sheet px-4 py-2 text-sm max-sm:-mx-4">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-primary">
            <TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
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
              tab === t ? TOGGLE_ON : TOGGLE_OFF,
            )}
          >
            {t === "deck" ? "Deck" : "Edit"}
          </button>
        ))}
      </div>

      <div className={cn("grid grid-cols-1 items-start gap-6 lg:grid-cols-2", statsReport && WITH_STATS_RAIL)}>
        {/* Unlabelled: the panel inside is the "Add cards" region, and one landmark per job is enough. */}
        <aside className={cn(HALF_SHEET, "min-w-0", tab === "deck" && "max-lg:hidden")}>
          <div className={HALF_SCROLL}>
            <CardSearchPanel builder={builder} colorIdentity={identity} collection={collection} />
          </div>
        </aside>

        <section aria-label="Deck list" data-tour={tour && `${tour}.list`} className={cn(HALF_SHEET, "min-w-0 scroll-mt-[var(--deck-bar-height,0px)]", tab === "add" && "max-lg:hidden")}>
          <div className={cn(HALF_SCROLL, "flex flex-col gap-5 pt-4")}>
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
                  {builder.commanders.map((card, i) => (
                    <CardPlate
                      key={card.id}
                      card={card}
                      quantity={1}
                      commander
                      onRemove={() => builder.remove(card)}
                      tourTarget={tour && i === 0 ? `${tour}.card` : undefined}
                    />
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
                    <CardPlate
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
          </div>
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
