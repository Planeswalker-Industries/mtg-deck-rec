"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary } from "@mtg/core/contract";
import { deckDiff, deckStats, type DeckStatsReport } from "@mtg/core/journey";
import { groupDeck, type DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { CopyDecklistButton } from "@/components/decks/deck-export";
import { CardPlate } from "@/components/cards/card-plate";
import { Button } from "@/components/ui/button";
import { deckFileName, downloadText } from "@/lib/deck-download";
import { formatAsOf } from "@/lib/format";
import { byCost, groupHeading } from "../deck-group-id";
import type { DeckJourney } from "./use-deck-journey";

/** Average mana value is shown to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;

/** One number before and after the round, and whether the change moved it toward where it should be. */
interface Tile {
  label: string;
  before: string;
  after: string;
  /** Closer to the target (better), further (worse), unchanged, or changed with no target to judge by. */
  verdict: "better" | "worse" | "same" | "neutral";
  direction: "up" | "down" | "none";
  /** A short line under the numbers: the target, or a price's date. */
  note?: string;
}

function judge(before: number, after: number, target: number | null): Pick<Tile, "verdict" | "direction"> {
  const direction = after > before ? "up" : after < before ? "down" : "none";
  if (direction === "none") return { verdict: "same", direction };
  if (target === null) return { verdict: "neutral", direction };
  return { verdict: Math.abs(after - target) < Math.abs(before - target) ? "better" : "worse", direction };
}

const wholeUsd = (usd: number) => `$${Math.round(usd).toLocaleString("en-US")}`;

const verdictText = (verdict: Tile["verdict"]) => (verdict === "better" ? "text-add" : verdict === "worse" ? "text-cut" : "text-muted-foreground");

function TileView({ tile }: { tile: Tile }) {
  const Arrow = tile.direction === "up" ? ArrowUp : tile.direction === "down" ? ArrowDown : null;
  return (
    <li
      className={cn(
        "flex flex-col gap-1 rounded-lg border bg-sleeve p-3",
        tile.verdict === "better" ? "border-add/60" : tile.verdict === "worse" ? "border-cut/60" : "border-seam",
        tile.verdict === "same" && "opacity-70",
      )}
    >
      <span className="text-xs text-muted-foreground">{tile.label}</span>
      <span className="flex flex-wrap items-center gap-x-1.5 font-mono text-lg tabular-nums">
        {tile.verdict !== "same" && (
          <>
            <span className="text-muted-foreground">{tile.before}</span>
            <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
          </>
        )}
        <span className={cn(tile.verdict !== "neutral" && tile.verdict !== "same" && verdictText(tile.verdict))}>{tile.after}</span>
        {Arrow && <Arrow aria-hidden className={cn("size-4", verdictText(tile.verdict))} />}
        <span className="sr-only">{tile.verdict === "same" ? ", unchanged" : `, was ${tile.before}`}</span>
      </span>
      {tile.note && <span className="text-xs text-muted-foreground">{tile.note}</span>}
    </li>
  );
}

/** A change the round made: a swap (out and in), a cut alone, or an add alone. */
interface Change {
  key: string;
  out?: { card: CardSummary; quantity: number };
  into?: { card: CardSummary; quantity: number };
}

/** The round's changes as pairs: each swap with its replacement, then the cuts and the adds left over. */
function changesOf(journey: DeckJourney): Change[] {
  const state = journey.state;
  if (!state) return [];
  const counted = (cards: readonly CardSummary[]) => {
    const byId = new Map<CardId, { card: CardSummary; quantity: number }>();
    for (const card of cards) byId.set(card.id, { card, quantity: (byId.get(card.id)?.quantity ?? 0) + 1 });
    return [...byId.values()];
  };
  return [
    ...state.swaps.map((s) => ({
      key: `swap-${s.target.id}-${s.replacement.id}`,
      out: { card: s.target, quantity: 1 },
      into: { card: s.replacement, quantity: 1 },
    })),
    ...counted(state.cuts).map((out) => ({ key: `cut-${out.card.id}`, out })),
    ...counted(state.adds).map((into) => ({ key: `add-${into.card.id}`, into })),
  ];
}

/**
 * Done: the round's result, shown rather than told. The numbers that moved (before → after, green when they moved
 * toward the commander's targets, red when away), every change as card plates, Out beside In, and the finished
 * decklist laid out by type on the plates the deck editor uses. From here the player saves, copies or downloads the
 * result, runs it through the journey again, or starts over.
 */
export function ReviewPhase({
  journey,
  report,
  busy,
  stale = false,
  onSave,
  onReanalyze,
  onStartOver,
  children,
}: {
  journey: DeckJourney;
  /** Deck stats for the deck as it stands, with each line's value when the round started; null without targets. */
  report: DeckStatsReport | null;
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
  /** Shown after the changes, e.g. the offer to import a collection. */
  children?: ReactNode;
}) {
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const before = deckStats(journey.before);
  const after = deckStats(journey.after);
  const asOf = after.priceAsOf ?? before.priceAsOf;
  const changes = changesOf(journey);
  const outs = changes.flatMap((c) => (c.out ? [c.out] : []));
  const ins = changes.flatMap((c) => (c.into ? [c.into] : []));
  const addedIds = new Set(deckDiff(state.base, deck).added.map((c) => c.cardId));
  const rounded = (n: number) => Number(n.toFixed(MANA_VALUE_DECIMALS));

  const tiles: Tile[] = [
    { label: "Cards", before: String(before.cards), after: String(after.cards), ...judge(before.cards, after.cards, COMMANDER_DECK_SIZE) },
    ...(report?.stats ?? []).map((line) => ({
      label: line.label,
      before: String(line.start),
      after: String(line.value),
      ...judge(line.start, line.value, line.target),
      note: `Aim ${Math.round(line.target)}`,
    })),
    {
      label: "Average mana value",
      before: before.averageManaValue.toFixed(MANA_VALUE_DECIMALS),
      after: after.averageManaValue.toFixed(MANA_VALUE_DECIMALS),
      ...judge(rounded(before.averageManaValue), rounded(after.averageManaValue), null),
    },
    {
      label: "Estimated price",
      // Whole dollars: a tile has room for two prices and an arrow, and cents are noise on an estimate.
      before: wholeUsd(before.priceUsd),
      after: wholeUsd(after.priceUsd),
      ...judge(Math.round(before.priceUsd), Math.round(after.priceUsd), null),
      ...(asOf ? { note: `Scryfall, ${formatAsOf(asOf)}${after.unpriced > 0 ? `, ${after.unpriced} unpriced` : ""}` } : {}),
    },
  ];

  const commanderIds = new Set<CardId>(deck.commanders);
  const commanders = journey.after.filter((e) => commanderIds.has(e.card.id));
  const groups = groupDeck(
    journey.after.filter((e) => !commanderIds.has(e.card.id)),
    "type",
  );
  const plates = (entries: readonly DeckEntry[], commander = false) =>
    byCost(entries).map(({ card, quantity }) => (
      <CardPlate key={card.id} card={card} quantity={quantity} commander={commander} mark={addedIds.has(card.id) ? "add" : undefined} />
    ));

  return (
    <div className="flex flex-col gap-6">
      <h2 className="sr-only">Done</h2>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" className="lit" onClick={onSave} disabled={busy || stale}>
          Save
        </Button>
        <CopyDecklistButton text={journey.resultText} size="lg" disabled={busy || stale} />
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={busy || stale}
          onClick={() => downloadText(journey.resultText(), deckFileName(deck.commanders.map((id) => journey.cards.get(id)?.name)))}
        >
          Download text
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onReanalyze} disabled={busy || stale}>
          Re-analyze
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={onStartOver} disabled={busy}>
          Start over
        </Button>
      </div>
      {stale && (
        <p role="status" className="-mt-3 text-sm text-muted-foreground">
          The decklist has changed since this deck was analyzed. Analyze it to save or re-analyze from here.
        </p>
      )}

      <section aria-label="Before and after">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {tiles.map((tile) => (
            <TileView key={tile.label} tile={tile} />
          ))}
        </ul>
      </section>

      {changes.length > 0 && (
        <section aria-labelledby="review-changes" className="flex flex-col gap-3">
          <h3 id="review-changes" className="font-heading text-xl leading-none font-semibold">
            Changes <span className="font-mono text-base font-normal text-muted-foreground">{changes.length}</span>
          </h3>
          {/*
            Out beside In. Swaps come first in both columns, so each sits on one row; the cuts and adds alone follow.
            Each plate floats its card on hover and enlarges it when pressed.
          */}
          <div className="grid grid-cols-2 items-start gap-x-3">
            <section aria-label="Out" className="flex flex-col gap-1.5">
              <h4 aria-hidden className="text-xs font-semibold text-cut">Out</h4>
              <ul className="flex flex-col gap-1.5">
                {outs.map(({ card, quantity }) => (
                  <CardPlate key={card.id} card={card} quantity={quantity} mark="cut" />
                ))}
              </ul>
            </section>
            <section aria-label="In" className="flex flex-col gap-1.5">
              <h4 aria-hidden className="text-xs font-semibold text-add">In</h4>
              <ul aria-label="Cards put in" className="flex flex-col gap-1.5">
                {ins.map(({ card, quantity }) => (
                  <CardPlate key={card.id} card={card} quantity={quantity} mark="add" />
                ))}
              </ul>
            </section>
          </div>
        </section>
      )}

      {children}

      <section aria-labelledby="review-decklist" className="flex flex-col gap-3">
        <h3 id="review-decklist" className="font-heading text-xl leading-none font-semibold">
          Decklist <span className="font-mono text-base font-normal text-muted-foreground">{after.cards}</span>
        </h3>
        {/* Columns like a decklist site: each type stays whole, and the plates flow into as many columns as fit. */}
        <div className="columns-1 gap-6 md:columns-2 2xl:columns-3">
          {commanders.length > 0 && (
            <section aria-label={commanders.length > 1 ? "Commanders" : "Commander"} className="mb-5 break-inside-avoid">
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">{commanders.length > 1 ? "Commanders" : "Commander"}</h4>
              <ul className="flex flex-col gap-1.5">{plates(commanders, true)}</ul>
            </section>
          )}
          {groups.map((group) => (
            <section key={group.key} aria-label={groupHeading(group.label)} className="mb-5 break-inside-avoid">
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
                {groupHeading(group.label)} <span className="font-mono font-normal">{group.count}</span>
              </h4>
              <ul aria-label={groupHeading(group.label)} className="flex flex-col gap-1.5">
                {plates(group.entries)}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
