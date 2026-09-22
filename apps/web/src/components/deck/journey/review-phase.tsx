"use client";

import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary } from "@mtg/core/contract";
import { CURVE_TOP_MANA_VALUE, deckDiff, deckSize, deckStats, type DeckStats } from "@mtg/core/journey";
import type { DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { formatAsOf, formatUsd } from "@/lib/format";
import { PhaseIntro } from "./journey-stepper";
import type { DeckJourney } from "./use-deck-journey";

/** Average mana value is shown to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;

/**
 * The mana curve as bars, one per mana value, the last collecting everything at CURVE_TOP_MANA_VALUE and above. One
 * series per chart (before and after are separate charts on the same scale), so the heading names it and there's no
 * legend. Each bar carries its count as a tooltip, and a table carries the same numbers for screen readers.
 */
function Curve({ curve, max, label, tone }: { curve: number[]; max: number; label: string; tone: "before" | "after" }) {
  const barLabel = (i: number) => (i === CURVE_TOP_MANA_VALUE ? `${i}+` : String(i));
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs text-muted-foreground">Mana curve, nonland cards</figcaption>
      <div aria-hidden className="flex h-20 items-end gap-0.5 border-b border-seam">
        {curve.map((count, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end justify-center" title={`Mana value ${barLabel(i)}: ${count}`}>
            <div
              className={cn("w-full rounded-t-[4px]", tone === "after" ? "bg-primary" : "bg-muted-foreground/60")}
              style={{ height: max > 0 ? `${(count / max) * 100}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-0.5 text-center text-[0.6875rem] text-muted-foreground tabular-nums">
        {curve.map((_, i) => (
          <span key={i} className="flex-1">
            {barLabel(i)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label} mana curve</caption>
        <tbody>
          {curve.map((count, i) => (
            <tr key={i}>
              <th scope="row">Mana value {barLabel(i)}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function StatsColumn({ title, stats, size, curveMax, tone }: { title: string; stats: DeckStats; size: number; curveMax: number; tone: "before" | "after" }) {
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
            <dd className={cn("text-right font-bold tabular-nums", k === "Cards" && size !== COMMANDER_DECK_SIZE && "text-cut")}>{v}</dd>
          </div>
        ))}
      </dl>
      <Curve curve={stats.curve} max={curveMax} label={title} tone={tone} />
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        {stats.types.map((t) => (
          <div key={t.label} className="contents">
            <dt className="text-muted-foreground">{t.label}</dt>
            <dd className="text-right tabular-nums">{t.count}</dd>
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
  onSave,
  onReanalyze,
  onStartOver,
}: {
  journey: DeckJourney;
  /** A commit is under way (re-parsing the result); the actions wait. */
  busy: boolean;
  onSave: () => void;
  onReanalyze: () => void;
  onStartOver: () => void;
}) {
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const before = deckStats(journey.before);
  const after = deckStats(journey.after);
  const curveMax = Math.max(...before.curve, ...after.curve);
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
        ...(quantity > 1 ? { caption: <span className="text-muted-foreground tabular-nums">{quantity} copies</span> } : {}),
      }))}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <PhaseIntro title="Review">
        {changed
          ? `${removed.reduce((n, e) => n + e.quantity, 0)} out, ${added.reduce((n, e) => n + e.quantity, 0)} in.`
          : "No changes this round."}{" "}
        {afterSize < COMMANDER_DECK_SIZE
          ? `The deck has ${afterSize} cards; a Commander deck needs ${COMMANDER_DECK_SIZE}. You can fill the rest in the editor.`
          : null}
      </PhaseIntro>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={onSave} disabled={busy}>
          Save
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onReanalyze} disabled={busy}>
          Re-analyze
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={onStartOver} disabled={busy}>
          Start over
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatsColumn title="Before" stats={before} size={beforeSize} curveMax={curveMax} tone="before" />
        <StatsColumn title="After" stats={after} size={afterSize} curveMax={curveMax} tone="after" />
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
