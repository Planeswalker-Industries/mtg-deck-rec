"use client";

import type { ReactNode } from "react";
import { EyeOff, TriangleAlert } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary, StatChoice, StatChoices } from "@mtg/core/contract";
import { CURVE_LINE, deckDiff, deckStats, type DeckStatsReport, type FixBlock } from "@mtg/core/journey";
import { groupDeck, type DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { CopyDecklistButton } from "@/components/decks/deck-export";
import { CardPlate } from "@/components/cards/card-plate";
import { Button } from "@/components/ui/button";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { deckFileName, downloadText } from "@/lib/deck-download";
import { formatAsOf } from "@/lib/format";
import { byCost, groupHeading } from "../deck-group-id";
import { LevelBadge } from "../deck-stats/level";
import type { RoundSave } from "./round-bar";
import { judge, Move, RoundMoves } from "./round-moves";
import type { DeckJourney } from "./use-deck-journey";
import type { Fix, FixLineLabel } from "./use-fix";

/** Average mana value is shown to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;

const wholeUsd = (usd: number) => `$${Math.round(usd).toLocaleString("en-US")}`;

/** A deck-wide number for the round's summary line: a small label over its before → after. */
function Figure({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:text-base">{children}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

/** A change the round made: a Fix move or a swap (out and in), a cut alone, or an add alone. */
interface Change {
  key: string;
  out?: { card: CardSummary; quantity: number };
  into?: { card: CardSummary; quantity: number };
}

/** The lines the player can't choose to ignore: they are rules, not typical counts. */
const RULE_LINES: ReadonlySet<string> = new Set(["legal", "bracket"]);

/** Why a line is still off at Finish: Fix's reason for having no move, a move still on offer, or the player's choice. */
type LeftoverReason = FixBlock | "open" | "ignored";

interface Leftover {
  line: string;
  label: FixLineLabel;
  reason: LeftoverReason;
}

/** "Blue sources: 14, needs 20" for a colour row, "Ramp: 10, about 14 is typical" for a count, the name alone for a rule. */
function leftoverText({ line, label }: Leftover): string {
  if (label.value === undefined || label.target === undefined) return label.label;
  const aim = Math.round(label.target);
  return line.startsWith("sources:") ? `${label.label}: ${label.value}, needs ${aim}` : `${label.label}: ${label.value}, about ${aim} is typical`;
}

/**
 * Every Deck stats line the round ends with out of line, each with its reason: the lines Fix still counts (`fix.lines`)
 * and the ones the player chose to ignore.
 */
function leftoversOf(fix: Fix, report: DeckStatsReport | null, choices: StatChoices): Leftover[] {
  const counted: Leftover[] = fix.lines.map((l) => ({ line: l.line, label: fix.lineLabel(l.line), reason: l.blocked ?? "open" }));
  const offKeys = new Set([...(report?.stats ?? []).filter((s) => !s.ok).map((s) => s.key), ...(report && !report.curve.ok ? [CURVE_LINE] : [])]);
  const ignored: Leftover[] = Object.entries(choices)
    .filter(([line, choice]) => choice === "ignore" && offKeys.has(line))
    .map(([line]) => ({ line, label: fix.lineLabel(line), reason: "ignored" }));
  return [...counted, ...ignored];
}

/** The round's changes as pairs: each Fix move and each swap with its replacement, then the cuts and the adds left over. */
function changesOf(journey: DeckJourney): Change[] {
  const state = journey.state;
  if (!state) return [];
  const counted = (cards: readonly CardSummary[]) => {
    const byId = new Map<CardId, { card: CardSummary; quantity: number }>();
    for (const card of cards) byId.set(card.id, { card, quantity: (byId.get(card.id)?.quantity ?? 0) + 1 });
    return [...byId.values()];
  };
  return [
    ...state.fixes.map((move, i) => ({
      key: `fix-${i}`,
      out: { card: move.out, quantity: 1 },
      into: { card: move.in, quantity: 1 },
    })),
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
 * Finish: the round's result, shown rather than told. How many Deck stats lines are in line, and each one that isn't
 * with its reason and what the player can do about it (T087); cards, mana value and price on one line, then each stat
 * line as a track from where the round started to where it ends against its aim (green toward it, red away), every
 * change as card plates, Out beside In, and the finished
 * decklist laid out by type on the plates the deck editor uses. From here the player saves, copies or downloads the
 * result (or a copy, from an open saved deck), or runs it through the journey again. Undo and Start over are in the
 * round's bar above, as on every step.
 */
export function ReviewPhase({
  journey,
  report,
  busy,
  stale = false,
  save,
  onReanalyze,
  fix,
  choices,
  onChoice,
  collectionOnly,
  children,
}: {
  /** Fix, for the lines still off and why, and to open it at one of them. */
  fix: Fix;
  /** The player's choices for Deck stats lines, and how one is made or taken back (null). */
  choices: StatChoices;
  onChoice: (line: string, choice: StatChoice | null) => void;
  /** Suggestions keep to the collection's cards: a line with nothing to bring in is a gap in the collection. */
  collectionOnly: boolean;
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
  /** What saving does: write back to the open saved deck (or save a copy), or save a new deck. */
  save: RoundSave;
  onReanalyze: () => void;
  /** Shown after the changes, e.g. the offer to import a collection. */
  children?: ReactNode;
}) {
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const overBy = journey.cutsNeeded;
  // A finished deck can still be off on what decks like it run: each line is named, with its reason.
  const leftovers = leftoversOf(fix, report, choices);
  const linkClass = cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer font-semibold");
  /** What a leftover says about itself, and what the player can do about it. */
  const leftoverRow = (leftover: Leftover) => {
    const { line, reason } = leftover;
    const canIgnore = !RULE_LINES.has(line);
    const fixLink = (
      <button type="button" className={linkClass} onClick={() => fix.openAt(line)}>
        Fix
      </button>
    );
    const ignore = canIgnore && (
      <Button type="button" size="sm" variant="outline" onClick={() => onChoice(line, "ignore")}>
        Ignore
      </Button>
    );
    const bought = choices[line] === "buy";
    const [why, actions]: [string, ReactNode] =
      reason === "ignored"
        ? [
            "Ignored",
            <button key="count" type="button" className={linkClass} onClick={() => onChoice(line, null)}>
              Count it
            </button>,
          ]
        : reason === "open"
          ? ["Can be fixed", fixLink]
          : reason === "skipped"
            ? ["Skipped by you", fixLink]
            : reason === "noCardOut"
              ? ["No safe card to take out", null]
              : collectionOnly && !bought
                ? [
                    "Not in your collection",
                    <span key="choice" className="flex flex-wrap gap-2">
                      {ignore}
                      <Button type="button" size="sm" variant="outline" onClick={() => onChoice(line, "buy")}>
                        Allow buying
                      </Button>
                    </span>,
                  ]
                : [bought ? "No card to buy for it" : "No card to bring in", ignore];
    const Icon = reason === "ignored" ? EyeOff : TriangleAlert;
    return (
      <li key={`${line}:${reason}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 flex-1 basis-48 items-start gap-2">
          <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", reason === "ignored" ? "text-muted-foreground" : "text-warning")} />
          <span className={cn(reason === "ignored" && "text-muted-foreground")}>
            {leftoverText(leftover)}
            <span className="block text-xs text-muted-foreground">{why}</span>
          </span>
        </span>
        {actions}
      </li>
    );
  };
  const before = deckStats(journey.before);
  const after = deckStats(journey.after);
  const asOf = after.priceAsOf ?? before.priceAsOf;
  const changes = changesOf(journey);
  const outs = changes.flatMap((c) => (c.out ? [c.out] : []));
  const ins = changes.flatMap((c) => (c.into ? [c.into] : []));
  const addedIds = new Set(deckDiff(state.base, deck).added.map((c) => c.cardId));
  const rounded = (n: number) => Number(n.toFixed(MANA_VALUE_DECIMALS));

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
      <h2 className="sr-only">Finish</h2>
      {overBy > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            The deck is {overBy} over 100.
            {journey.phases.includes("cut") && (
              <>
                {" "}
                <button type="button" className={linkClass} onClick={() => journey.goTo("cut")}>
                  Back to Cut
                </button>
              </>
            )}
          </span>
        </p>
      )}
      {report && (
        <section aria-labelledby="review-deck-stats" className="flex flex-col gap-2 rounded-lg border border-seam bg-sleeve px-3 py-2.5 text-sm">
          <h3 id="review-deck-stats" className="flex items-center justify-between gap-3 font-semibold">
            Deck stats
            <LevelBadge level={report.level} okCount={report.okCount} total={report.total} />
          </h3>
          {!fix.ready ? (
            <p role="status" className="text-muted-foreground">
              Checking what is left to fix…
            </p>
          ) : leftovers.length === 0 ? (
            <p className="text-muted-foreground">Every line is in line.</p>
          ) : (
            <ul aria-label="Lines still off" className="flex flex-col gap-2.5">
              {leftovers.map(leftoverRow)}
            </ul>
          )}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {save.kind === "open" ? (
          <>
            <Button type="button" size="lg" className="lit" onClick={save.onSaveChanges} disabled={busy || stale}>
              Save changes
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={save.onSaveCopy} disabled={busy || stale || save.copy.status === "saving"}>
              Save as copy
            </Button>
          </>
        ) : (
          <Button type="button" size="lg" className="lit" onClick={save.onSave} disabled={busy || stale}>
            Save deck
          </Button>
        )}
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
      </div>
      {stale && (
        <p role="status" className="-mt-3 text-sm text-muted-foreground">
          The decklist has changed since this deck was analyzed. Analyze it to save or re-analyze from here.
        </p>
      )}

      <section aria-label="Before and after" className="flex flex-col gap-4 rounded-lg border border-seam bg-sleeve p-4">
        <dl className="grid grid-cols-3 gap-3">
          <Figure label="Cards">
            <Move before={before.cards} after={after.cards} verdict={judge(before.cards, after.cards, COMMANDER_DECK_SIZE)} />
          </Figure>
          <Figure label="Avg mana value">
            <Move
              before={rounded(before.averageManaValue)}
              after={rounded(after.averageManaValue)}
              verdict={judge(rounded(before.averageManaValue), rounded(after.averageManaValue), null)}
              format={(n) => n.toFixed(MANA_VALUE_DECIMALS)}
            />
          </Figure>
          {/* Whole dollars: cents are noise on an estimate. */}
          <Figure
            label="Price"
            note={asOf ? `Scryfall, ${formatAsOf(asOf)}${after.unpriced > 0 ? `, ${after.unpriced} unpriced` : ""}` : undefined}
          >
            <Move
              before={Math.round(before.priceUsd)}
              after={Math.round(after.priceUsd)}
              verdict={judge(Math.round(before.priceUsd), Math.round(after.priceUsd), null)}
              format={wholeUsd}
            />
          </Figure>
        </dl>
        {report && report.stats.length > 0 && <RoundMoves lines={report.stats} />}
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
