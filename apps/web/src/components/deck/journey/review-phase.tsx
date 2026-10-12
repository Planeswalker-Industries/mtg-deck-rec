"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary } from "@mtg/core/contract";
import { deckDiff, deckStats, type DeckStatsReport } from "@mtg/core/journey";
import { groupDeck, type DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { CopyDecklistButton } from "@/components/decks/deck-export";
import { DeckRow } from "@/components/deckbuilder/deck-row";
import { Button } from "@/components/ui/button";
import { deckFileName, downloadText } from "@/lib/deck-download";
import { formatAsOf, formatUsd } from "@/lib/format";
import { byCost, groupHeading } from "../deck-group-id";
import type { DeckJourney } from "./use-deck-journey";

/** Average mana value is shown to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;
/** The preview's cards: two side by side, so about half a phone's width each, and a fixed column on wide screens. */
const PREVIEW_SIZES = "(min-width: 1024px) 140px, 45vw";

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
      <span className="flex items-center gap-1.5 font-mono text-lg tabular-nums">
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

/** The chosen change, large: the card that went and the card that came, side by side. Pressing one enlarges it. */
function ChangePreview({ change }: { change: Change }) {
  const side = (entry: NonNullable<Change["out"]>, mark: "cut" | "add") => (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <figcaption className={cn("text-xs font-semibold", mark === "cut" ? "text-cut" : "text-add")}>{mark === "cut" ? "Out" : "In"}</figcaption>
      <ZoomableCard card={entry.card}>
        <CardImage
          card={entry.card}
          variant="normal"
          alt={entry.card.name}
          sizes={PREVIEW_SIZES}
          className={cn("ring-2", mark === "cut" ? "ring-cut saturate-50" : "ring-add")}
        />
      </ZoomableCard>
    </figure>
  );
  // A cut or an add alone shows its one card, at the same size as a pair's.
  return (
    <div aria-live="polite" className="flex gap-3">
      {change.out && side(change.out, "cut")}
      {change.into && side(change.into, "add")}
      {!(change.out && change.into) && <div aria-hidden className="flex-1" />}
    </div>
  );
}

/**
 * Done: the round's result, shown rather than told. The numbers that moved (before → after, green when they moved
 * toward the commander's targets, red when away), every change as a pair of name plates with a large preview of the
 * chosen one, and the finished decklist laid out by type on the plates the deck editor uses. From here the player
 * saves, copies or downloads the result, runs it through the journey again, or starts over.
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
  const [selected, setSelected] = useState(0);
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const before = deckStats(journey.before);
  const after = deckStats(journey.after);
  const asOf = after.priceAsOf ?? before.priceAsOf;
  const changes = changesOf(journey);
  const chosenIndex = Math.min(selected, changes.length - 1);
  const chosen = changes[chosenIndex];
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
      before: formatUsd(before.priceUsd),
      after: formatUsd(after.priceUsd),
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
      <DeckRow key={card.id} card={card} quantity={quantity} commander={commander} mark={addedIds.has(card.id) ? "add" : undefined} />
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

      {chosen && (
        <section aria-labelledby="review-changes" className="flex flex-col gap-3">
          <h3 id="review-changes" className="font-heading text-xl leading-none font-semibold">
            Changes <span className="font-mono text-base font-normal text-muted-foreground">{changes.length}</span>
          </h3>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            {/* Phones see the chosen change first, then the list to choose from; wide screens keep it beside the list. */}
            <div className="lg:sticky lg:top-[calc(var(--deck-bar-height,0px)+1rem)] lg:order-last">
              <ChangePreview change={chosen} />
            </div>
            <ul aria-label="Changes this round" className="flex flex-col gap-2">
              {changes.map((change, index) => (
                <li key={change.key}>
                  {/* A swap reads out → in; a cut or an add alone is one plate in its own column. */}
                  <ul className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)]">
                    {change.out && (
                      <DeckRow
                        card={change.out.card}
                        quantity={change.out.quantity}
                        mark="cut"
                        selected={index === chosenIndex}
                        onSelect={() => setSelected(index)}
                      />
                    )}
                    {change.out && change.into && (
                      <li aria-hidden className="hidden justify-center text-muted-foreground sm:flex">
                        <ArrowRight className="size-4" />
                      </li>
                    )}
                    {change.into && (
                      <DeckRow
                        card={change.into.card}
                        quantity={change.into.quantity}
                        mark="add"
                        selected={index === chosenIndex}
                        onSelect={() => setSelected(index)}
                        className={cn(!change.out && "sm:col-start-3")}
                      />
                    )}
                  </ul>
                </li>
              ))}
            </ul>
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
