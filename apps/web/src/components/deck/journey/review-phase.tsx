"use client";

import type { ReactNode } from "react";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary, StatChoice, StatChoices } from "@mtg/core/contract";
import { CURVE_LINE, deckDiff, deckStats, type DeckStatsReport, type FixBlock } from "@mtg/core/journey";
import { groupDeck, type DeckEntry } from "@mtg/core/scoring";
import { cn } from "cn";
import { CopyDecklistButton } from "@/components/decks/deck-export";
import { ShoppingList } from "@/components/decks/shopping-list";
import { BuyButtons, CartTotal, type BuySaveState } from "@/components/decks/buy-buttons";
import type { ShoppingCart } from "@/components/decks/use-shopping-cart";
import { CardPlate } from "@/components/cards/card-plate";
import { Button } from "@/components/ui/button";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { deckFileName, downloadText } from "@/lib/deck-download";
import { formatAsOf } from "@/lib/format";
import { byCost, groupHeading } from "../deck-group-id";
import { LevelBadge, Mark } from "../deck-stats/level";
import { CopySaveStatus, RoundControls, type RoundSave } from "./round-bar";
import { StatRingGroups } from "../deck-stats/stat-ring";
import { judge, Move } from "./round-moves";
import { Upgrades } from "./upgrades";
import type { DeckJourney } from "./use-deck-journey";
import type { Fix, FixLineLabel } from "./use-fix";

/** Average mana value is shown to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;
/** One part of the result: a sheet of paper on the wood, padded like the journey's other sheets (`Panel` sm). */
const SECTION_SHEET = "sheet p-4";
/**
 * Half a deck: a shopping list that long is most of the Decklist below it, so it opens on its first group with "Show
 * all" rather than run the same cards down Finish twice.
 */
const FOLD_SHOPPING_LIST_AT = COMMANDER_DECK_SIZE / 2;

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
  return line.startsWith("sources:")
    ? `${label.label}: ${label.value}, needs ${aim}`
    : `${label.label}: ${label.value}, about ${aim} is typical`;
}

/**
 * Every Deck stats line the round ends with out of line, each with its reason: the lines Fix still counts (`fix.lines`)
 * and the ones the player chose to ignore.
 */
function leftoversOf(fix: Fix, report: DeckStatsReport | null, choices: StatChoices): Leftover[] {
  const counted: Leftover[] = fix.lines.map((l) => ({ line: l.line, label: fix.lineLabel(l.line), reason: l.blocked ?? "open" }));
  const offKeys = new Set([
    ...(report?.stats ?? []).filter((s) => !s.ok).map((s) => s.key),
    ...(report && !report.curve.ok ? [CURVE_LINE] : []),
  ]);
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

/** The cards the round put in that the deck didn't start with, in the order Finish lists them: the shopping list's round. */
export function roundInIds(journey: DeckJourney): CardId[] {
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return [];
  const addedIds = new Set(deckDiff(state.base, deck).added.map((c) => c.cardId));
  return [...new Set(changesOf(journey).flatMap((c) => (c.into && addedIds.has(c.into.card.id) ? [c.into.card.id] : [])))];
}

/**
 * Finish: the round's result, shown rather than told. It leads with "Deck Complete!" and the round's Undo, Start over and
 * Save in its top right (owner, 2026-11-23), the cart total and Buy on TCGplayer as the seal (or, when the collection
 * supplies every card, the upgrades worth buying and their Buy), with Copy, Download and Re-analyze in one outline row
 * beside it (T102). Then one Deck stats sheet: cards, mana value and the deck's value before and after, each stat line as
 * a read-only bar from where the round started to where it ends against its aim, and each line still off with its
 * reason and what the player can do about it (T087). Then the shopping list, every change as card plates (Out beside
 * In) and the finished decklist laid out by type on the plates the deck editor uses.
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
  cart,
  onBuy,
  buySaved,
}: {
  /** The round's cart, which the docked Deck stats bar and the Budget line also read: the shopping list renders it. */
  cart: ShoppingCart;
  /** Called as a cart opens: saves the deck to My Decks for a signed-in player, as every Buy does (T102). */
  onBuy: () => void;
  /** What became of that save. */
  buySaved: BuySaveState;
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
}) {
  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const overBy = journey.cutsNeeded;
  // A finished deck can still be off on what decks like it run: each line is named, with its reason.
  const leftovers = leftoversOf(fix, report, choices);
  const linkClass = cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer font-semibold");
  /**
   * What a leftover offers, as the Deck stats rail lays it out: a short word and a link beside the line's name (Fix,
   * Skipped and Fix, Ignored and Count it), and, where the reason needs buttons of its own, a note under it.
   */
  const leftoverParts = (leftover: Leftover): { inline: ReactNode; note: ReactNode } => {
    const { line, reason } = leftover;
    const link = (label: string, onClick: () => void) => (
      <button type="button" className={cn(linkClass, "shrink-0 text-xs")} onClick={onClick}>
        {label}
      </button>
    );
    const word = (text: string) => <span className="shrink-0 text-xs text-muted-foreground">{text}</span>;
    const fixLink = link("Fix", () => fix.openAt(line));
    if (reason === "open") return { inline: fixLink, note: null };
    if (reason === "skipped")
      return {
        inline: (
          <>
            {word("Skipped")}
            {fixLink}
          </>
        ),
        note: null,
      };
    if (reason === "ignored")
      return {
        inline: (
          <>
            {word("Ignored")}
            {link("Count it", () => onChoice(line, null))}
          </>
        ),
        note: null,
      };
    const ignore = !RULE_LINES.has(line) && (
      <Button type="button" size="sm" variant="outline" onClick={() => onChoice(line, "ignore")}>
        Ignore
      </Button>
    );
    const bought = choices[line] === "buy";
    const [why, actions]: [string, ReactNode] =
      reason === "noCardOut"
        ? ["No safe card to take out", null]
        : collectionOnly && !bought
          ? [
              "Not in your collection",
              <>
                {ignore}
                <Button type="button" size="sm" variant="outline" onClick={() => onChoice(line, "buy")}>
                  Allow buying
                </Button>
              </>,
            ]
          : [bought ? "No card to buy for it" : "No card to bring in", ignore];
    return {
      inline: null,
      note: (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {why}
          {actions}
        </span>
      ),
    };
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

  // The lines with a bar of their own carry their leftover under it; the rest (rules, the curve) are listed above the bars.
  const statKeys = new Set((report?.stats ?? []).map((l) => l.key));
  const leftoverByLine = new Map(leftovers.filter((l) => statKeys.has(l.line)).map((l) => [l.line, l]));
  const otherLeftovers = leftovers.filter((l) => !statKeys.has(l.line));
  const blocked = busy || stale;
  /** Nothing to buy because the collection supplies every card (not because the player removed them). */
  const offerUpgrades = cart.fromCollection && cart.list?.count === 0 && cart.removed.length === 0;
  // The shopping list shows unless it would only repeat the top sheet's "You own every card." (its scope toggle and a
  // removal's empty state still have a use there).
  const listed = !(cart.list?.count === 0 && cart.removed.length === 0 && !cart.scopeToggle);
  const nothingToBuy = cart.fromCollection
    ? "You own every card."
    : cart.removed.length > 0
      ? "You removed every card."
      : cart.scopeToggle && cart.scope === "round"
        ? "This round put in no cards to buy."
        : "Nothing to buy.";

  /*
   * Finish leads with the deck being done and what it costs to get (T102): the total and Buy, the page's seal, then the
   * other ways to take the deck away in one outline row. Deck stats, the lines still off and their Fix links follow in one
   * sheet; then the shopping list, the changes and the decklist. On a phone that is one column. From xl (the Deck stats
   * rail already takes a right column from lg) the shopping list is an aside on the right from the top, kept in view
   * while the rest scrolls; the left items name only their column, so auto-placement stacks them in rows 1-4 beside it.
   */
  return (
    // Without the shopping list there is no aside, so the page keeps one column rather than an empty right one.
    <div className={cn("flex flex-col gap-4", listed && "xl:grid xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start")}>
      <section aria-labelledby="review-ready" className={cn(SECTION_SHEET, "flex flex-col gap-3 xl:col-start-1")}>
        {/*
          The round's Undo, Start over and Save sit in the top right, as on every step, on the heading's line (owner,
          2026-11-23): the heading steps down a size on phones so both fit the 390 px width.
        */}
        <div className="flex items-center justify-between gap-2">
          <h2 id="review-ready" className="min-w-0 font-heading text-xl leading-none font-semibold sm:text-2xl">
            {overBy > 0 ? "Almost ready" : "Deck Complete!"}
          </h2>
          <RoundControls
            canUndo={journey.canUndo}
            onUndo={journey.undo}
            onStartOver={journey.restart}
            save={save}
            busy={blocked}
            className="shrink-0"
          />
        </div>
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
        <CartTotal cart={cart} emptyText={nothingToBuy} />
        {/*
          A deck the collection fully supplies has nothing to buy, so Finish offers what would improve it instead (T102),
          with its own Buy in the seal's place.
        */}
        {offerUpgrades && journey.workingContext && (
          <Upgrades context={journey.workingContext} onBuy={onBuy} saved={buySaved} className="border-t border-seam pt-3" />
        )}
        {/* From sm the outline row sits beside Buy rather than under it, so the sheet isn't half empty on a wide screen. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <BuyButtons carts={cart.carts} onBuy={onBuy} saved={buySaved} seal className="max-sm:items-stretch max-sm:[&_a]:flex-1" />
          {/* Symbols, not words (owner, 2026-11-23): each names itself to screen readers and on hover. */}
          <div className="flex flex-wrap gap-2 sm:py-1">
            <CopyDecklistButton text={journey.resultText} iconOnly outline disabled={blocked} />
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              disabled={blocked}
              aria-label="Download text"
              title="Download text"
              onClick={() => downloadText(journey.resultText(), deckFileName(deck.commanders.map((id) => journey.cards.get(id)?.name)))}
            >
              <Download aria-hidden />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              onClick={onReanalyze}
              disabled={blocked}
              aria-label="Re-analyze"
              title="Re-analyze"
            >
              <RefreshCw aria-hidden />
            </Button>
          </div>
        </div>
        <CopySaveStatus save={save} />
        {stale && (
          <p role="status" className="text-sm text-muted-foreground">
            The decklist has changed since this deck was analyzed. Analyze it to save or re-analyze from here.
          </p>
        )}
      </section>
      <section aria-labelledby="review-deck-stats" className={cn(SECTION_SHEET, "flex flex-col gap-4 xl:col-start-1")}>
        <h3 id="review-deck-stats" className="flex items-center justify-between gap-3">
          <span className="font-heading text-xl leading-none font-semibold">Deck stats</span>
          {report && <LevelBadge level={report.level} okCount={report.okCount} total={report.total} />}
        </h3>
        <dl className={cn("grid gap-3", cart.fromCollection ? "grid-cols-3" : "grid-cols-2")}>
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
          {/*
              Whole dollars: cents are noise on an estimate. The whole deck, basics and owned cards included, so it is
              named apart from the cart total the shopping list and Deck stats show. Only with a collection: without
              one the cart is the deck but its basics, and two near-equal totals read as a mistake.
            */}
          {cart.fromCollection && (
            <Figure
              label="Deck value"
              note={asOf ? `Scryfall, ${formatAsOf(asOf)}${after.unpriced > 0 ? `, ${after.unpriced} unpriced` : ""}` : undefined}
            >
              <Move
                before={Math.round(before.priceUsd)}
                after={Math.round(after.priceUsd)}
                verdict={judge(Math.round(before.priceUsd), Math.round(after.priceUsd), null)}
                format={wholeUsd}
              />
            </Figure>
          )}
        </dl>
        {report &&
          (!fix.ready ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking what is left to fix…
            </p>
          ) : leftovers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every line is in line.</p>
          ) : (
            otherLeftovers.length > 0 && (
              <ul aria-label="Lines still off" className="flex flex-col gap-2 text-sm">
                {otherLeftovers.map((l) => {
                  const { inline, note } = leftoverParts(l);
                  return (
                    <li key={`${l.line}:${l.reason}`} className="flex flex-col gap-1">
                      <span className={cn("flex min-w-0 items-center gap-2", l.reason === "ignored" && "text-muted-foreground")}>
                        <Mark state={l.reason === "ignored" ? "ignored" : "off"} />
                        <span className="min-w-0">{leftoverText(l)}</span>
                        {inline}
                      </span>
                      {note && <span className="pl-6">{note}</span>}
                    </li>
                  );
                })}
              </ul>
            )
          ))}
        {report && report.stats.length > 0 && (
          <>
            {/* The rings fill as the section comes into view: closed to OK, or what is left to do (owner, 2026-11-23). */}
            <StatRingGroups
              lines={report.stats}
              actionFor={(line) => {
                const leftover = fix.ready ? leftoverByLine.get(line.key) : undefined;
                return leftover && leftoverParts(leftover).inline;
              }}
            />
            {/* A reason that needs buttons of its own goes under the rings, named by its line. */}
            {report.stats.map((line) => {
              const leftover = fix.ready ? leftoverByLine.get(line.key) : undefined;
              const note = leftover && leftoverParts(leftover).note;
              return note ? (
                <div key={line.key} className="flex flex-col gap-1 border-t border-seam pt-2 text-sm">
                  <span className="font-semibold">{line.label}</span>
                  {note}
                </div>
              ) : null;
            })}
          </>
        )}
      </section>

      {listed && (
        <aside className="xl:sticky xl:top-[calc(var(--deck-bar-height,0px)+1rem)] xl:col-start-2 xl:row-span-4 xl:row-start-1 xl:max-h-[calc(100dvh-var(--deck-bar-height,0px)-2rem)] xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
          <div className={SECTION_SHEET}>
            <ShoppingList cart={cart} pinActions buy={false} foldAt={FOLD_SHOPPING_LIST_AT} />
          </div>
        </aside>
      )}

      {changes.length > 0 && (
        <section aria-labelledby="review-changes" className={cn(SECTION_SHEET, "flex flex-col gap-3 xl:col-start-1")}>
          <h3 id="review-changes" className="font-heading text-xl leading-none font-semibold">
            Changes <span className="font-mono text-base font-normal text-muted-foreground">{changes.length}</span>
          </h3>
          {/*
              Out beside In. Swaps come first in both columns, so each sits on one row; the cuts and adds alone follow.
              Each plate floats its card on hover and enlarges it when pressed.
            */}
          <div className="grid grid-cols-2 items-start gap-x-3">
            <section aria-label="Out" className="flex flex-col gap-1.5">
              <h4 aria-hidden className="text-xs font-semibold text-cut">
                Out
              </h4>
              <ul className="flex flex-col gap-1.5">
                {outs.map(({ card, quantity }) => (
                  <CardPlate key={card.id} card={card} quantity={quantity} mark="cut" />
                ))}
              </ul>
            </section>
            <section aria-label="In" className="flex flex-col gap-1.5">
              <h4 aria-hidden className="text-xs font-semibold text-add">
                In
              </h4>
              <ul aria-label="Cards put in" className="flex flex-col gap-1.5">
                {ins.map(({ card, quantity }) => (
                  <CardPlate key={card.id} card={card} quantity={quantity} mark="add" />
                ))}
              </ul>
            </section>
          </div>
        </section>
      )}

      <section aria-labelledby="review-decklist" className={cn(SECTION_SHEET, "flex flex-col gap-3 xl:col-start-1")}>
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
