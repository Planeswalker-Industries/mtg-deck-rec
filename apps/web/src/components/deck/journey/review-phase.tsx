"use client";

import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary } from "@mtg/core/contract";
import { deckDiff, deckSize, deckStats, type DeckStats } from "@mtg/core/journey";
import type { DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { formatAsOf, formatUsd } from "@/lib/format";
import { PhaseIntro } from "./journey-stepper";
import type { DeckJourney } from "./use-deck-journey";

/** Average mana value is shown to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;

function StatsColumn({ title, stats, size }: { title: string; stats: DeckStats; size: number }) {
  const rows: [string, string][] = [
    ["Cards", String(size)],
    ["Lands", String(stats.lands)],
    ["Average mana value", stats.averageManaValue.toFixed(MANA_VALUE_DECIMALS)],
    ["Game Changers", String(stats.gameChangers)],
    ["Estimated price", `${formatUsd(stats.priceUsd)}${stats.unpriced > 0 ? ` (${stats.unpriced} unpriced)` : ""}`],
  ];
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-seam bg-sleeve p-4">
      <h3 className="font-heading text-xl leading-none font-semibold">{title}</h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn("text-right font-mono", k === "Cards" && size !== COMMANDER_DECK_SIZE && "text-cut")}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Review: the deck before and after, and what changed. From here the player saves the result, runs it through the
 * journey again, or starts over from the deck they first brought.
 */
export function ReviewPhase({
  journey,
  busy,
  stale = false,
  onSave,
  onReanalyze,
  onStartOver,
}: {
  journey: DeckJourney;
  /** A commit is under way (re-parsing the result); the actions wait. */
  busy: boolean;
  /**
   * The decklist box has changed since this round's deck was analyzed. Saving or re-analyzing the round would write its
   * result over those edits, so both wait until the new decklist is analyzed.
   */
  stale?: boolean;
  onSave: () => void;
  onReanalyze: () => void;
  onStartOver: () => void;
}) {
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const before = deckStats(journey.before);
  const after = deckStats(journey.after);
  const beforeSize = deckSize(state.base);
  const afterSize = deckSize(deck);
  const diff = deckDiff(state.base, deck);
  const cardsFor = (changes: { cardId: CardId; quantity: number }[]) =>
    changes.flatMap((c) => {
      const card = journey.cards.get(c.cardId);
      return card ? [{ card, quantity: c.quantity }] : [];
    });
  const removed = cardsFor(diff.removed);
  const added = cardsFor(diff.added);
  const asOf = after.priceAsOf ?? before.priceAsOf;
  const changed = removed.length > 0 || added.length > 0;

  const grid = (entries: DeckEntry[], label: string, mark: "cut" | "add") => (
    <PocketGrid
      zoomable
      label={label}
      items={entries.map(({ card, quantity }: { card: CardSummary; quantity: number }) => ({
        card,
        mark,
        ...(quantity > 1 ? { caption: <span className="text-muted-foreground font-mono">{quantity} copies</span> } : {}),
      }))}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PhaseIntro title="Done">
        {changed
          ? `${removed.reduce((n, e) => n + e.quantity, 0)} out, ${added.reduce((n, e) => n + e.quantity, 0)} in.`
          : "No changes this round."}{" "}
        {afterSize < COMMANDER_DECK_SIZE
          ? `The deck has ${afterSize} cards; a Commander deck needs ${COMMANDER_DECK_SIZE}. You can fill the rest in the editor.`
          : null}
      </PhaseIntro>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={onSave} disabled={busy || stale}>
          Save
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onReanalyze} disabled={busy || stale}>
          Re-analyze
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={onStartOver} disabled={busy}>
          Start over
        </Button>
      </div>
      {stale && (
        <p role="status" className="-mt-2 text-sm text-muted-foreground">
          The decklist has changed since this deck was analyzed. Analyze it to save or re-analyze from here.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatsColumn title="Before" stats={before} size={beforeSize} />
        <StatsColumn title="After" stats={after} size={afterSize} />
      </div>
      {asOf && <p className="-mt-2 text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(asOf)}.</p>}

      {removed.length > 0 && (
        <section aria-labelledby="review-out" className="flex flex-col gap-2">
          <h3 id="review-out" className="font-heading text-xl leading-none font-semibold text-cut">
            Out
          </h3>
          {grid(removed, "Cards taken out", "cut")}
        </section>
      )}
      {added.length > 0 && (
        <section aria-labelledby="review-in" className="flex flex-col gap-2">
          <h3 id="review-in" className="font-heading text-xl leading-none font-semibold text-add">
            In
          </h3>
          {grid(added, "Cards put in", "add")}
        </section>
      )}
    </div>
  );
}
