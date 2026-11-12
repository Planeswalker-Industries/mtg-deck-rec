"use client";

import { useState } from "react";
import { Check, Scissors, TriangleAlert } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary, CutReason, CutResult } from "@mtg/core/contract";
import { lastResortCuts, trimCuts, type RoomCard, type StatLine } from "@mtg/core/journey";
import { isFrontLand } from "@mtg/core/scoring";
import { Button } from "@/components/ui/button";
import { cutReasonLabel, cutReasonShortLabel } from "@/lib/labels";
import { DeckGroupsPanel } from "../deck-groups-panel";
import { PanelError } from "../panel-state";
import { ShuffleDeck } from "../shuffle-deck";
import type { DeckGroups } from "../use-deck-groups";
import type { Async } from "../use-deck-tool";
import { NextBar, PhaseIntro, StepStatus } from "./journey-stepper";
import { LandCuts, type LandCount } from "./land-cuts";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import type { DeckJourney } from "./use-deck-journey";

/** Reasons shown under a card, with collection ownership last when present. */
const MAX_REASONS = 2;
/** Trim candidates after the one on screen whose rules text is fetched ahead. */
const PREFETCH_CARDS = 4;

function shownReasons(reasons: readonly CutReason[]): CutReason[] {
  const notOwned = reasons.includes("NOT_OWNED");
  const others = reasons.filter((reason) => reason !== "NOT_OWNED").slice(0, notOwned ? MAX_REASONS - 1 : MAX_REASONS);
  return notOwned ? [...others, "NOT_OWNED"] : others;
}

function reasonText(reasons: readonly CutReason[]): string {
  return shownReasons(reasons).map((reason) => cutReasonLabel[reason]).join(". ");
}

/** What trimming reads from Deck stats: every stat line (lands too), and each analyzed card's tracked roles. */
export interface TrimInputs {
  stats: readonly StatLine[];
  cardRoles: Readonly<Record<number, readonly string[]>>;
}

const s = (n: number) => (n === 1 ? "" : "s");

/** A card that is a piece of a complete combo: cutting it breaks the combo, so it says what it would lose. */
function ComboWarning({ result }: { result: string }) {
  return (
    <span className="inline-flex items-start gap-1 font-semibold text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      Combo piece: {result}
    </span>
  );
}

/**
 * Cut, the first step of a deck over 100: bring it back to 100, and no further. Cards that break a rule come first
 * (the cut list's mandatory ones); then the trim (`trimCuts`): cards in the roles the deck has too much of, weakest
 * first, never one filling a role it is short of. Swiping deals them one at a time (✂ cut, ✓ keep). While the deck is
 * still over 100 after that, Cut offers its lands together, as −/+ counts, and then (or once the player passes on lands)
 * deals the rest of the deck (`lastResortCuts`) until it is at 100. The round can't go on to Fix over 100; what is still
 * off at 100 (a rule break left in, a line out of its band) is Fix's to trade one card for one. The list shows the whole
 * deck with the cuts crossed out; tapping a card cuts it (a copy a tap for basic lands, which also get −/+ counts), and
 * tapping a crossed-out one puts it back.
 */
export function CutPhase({
  journey,
  cutState,
  view,
  deckGroups,
  trim,
  onShowList,
}: {
  journey: DeckJourney;
  cutState: Async<CutResult>;
  view: "swipe" | "list";
  deckGroups: DeckGroups;
  /** Absent where Deck stats has no targets: then only the rule breaks are dealt. */
  trim?: TrimInputs;
  /** Switches to the list view, to cut any card by hand. */
  onShowList: () => void;
}) {
  const { recommended, undecided, isMarked, cutCopies, owed: owedAfterRuleBreaks, restore, toggle, take, finish } = journey.cut;
  /** The player passed on cutting lands, so Cut deals the rest of the deck instead. */
  const [landsPassed, setLandsPassed] = useState(false);

  if (cutState.status === "loading" || cutState.status === "idle") return <ShuffleDeck label="Checking the deck for cards to cut" />;
  if (cutState.status === "error") return <PanelError message={cutState.message} />;

  const state = journey.state;
  const deck = journey.deck;
  if (!state || !deck) return null;

  const owed = journey.cutsNeeded;
  const size = COMMANDER_DECK_SIZE - journey.openSlots + owed;
  // Undecided rule breaks go when the player moves on, so they count toward what's owed.
  const trimOwed = Math.max(0, owed - undecided.length);
  const roles = (trim?.stats ?? []).filter((r) => r.group === "roles");
  const landsLine = trim?.stats.find((r) => r.key === "lands");
  const roleRows = roles.map((r) => ({ roleId: r.key, value: r.value, target: r.target }));
  const reasonsFor = new Map(cutState.data.suggestions.map((sug) => [sug.card.id as number, sug.reasons]));
  const mandatoryIds = new Set<number>(recommended.map((sug) => sug.card.id));
  // Combo pieces are never trimmed or dealt as a last resort: cutting one is the player's call, with a warning.
  const pieces = journey.protectedPieces;
  const spared = new Set<CardId>([...state.kept, ...pieces.keys()]);
  const withWarning = (card: CardSummary, text: string) => {
    const result = pieces.get(card.id);
    return result ? (
      <span className="flex flex-col gap-1">
        <ComboWarning result={result} />
        <span>{text}</span>
      </span>
    ) : (
      text
    );
  };

  /** Copies of a card left in the deck as it stands, for a card with several (basic lands). */
  const copiesLeft = (id: CardId) => deck.cards.find((entry) => entry.section === "main" && entry.cardId === id)?.quantity ?? 0;
  /** The lands the round started with, most copies first, each with what is left of it. */
  const lands: LandCount[] = state.base.cards
    .filter((entry) => entry.section === "main")
    .flatMap((entry) => {
      const card = journey.cards.get(entry.cardId);
      return card && isFrontLand(card.typeLine) ? [{ card, copies: entry.quantity, left: copiesLeft(card.id) }] : [];
    })
    .sort((a, b) => b.copies - a.copies || a.card.name.localeCompare(b.card.name));
  const basics = lands.filter((land) => land.copies > 1);

  const roomCards: RoomCard[] = deck.cards
    .filter((entry) => entry.section === "main" && !mandatoryIds.has(entry.cardId))
    .flatMap((entry) => {
      const card = journey.cards.get(entry.cardId);
      return card ? [{ id: card.id, isLand: isFrontLand(card.typeLine), manaValue: card.manaValue, roles: trim?.cardRoles[card.id] ?? [] }] : [];
    });
  const cutScores = new Map(cutState.data.suggestions.map((sug) => [sug.card.id, sug.cutScore]));
  const trimIds = trim
    ? trimCuts({
        cards: roomCards,
        roles: roleRows,
        landsOver: landsLine ? !landsLine.ok && landsLine.value > landsLine.target : false,
        cutScores,
        spared,
        focusRoleId: null,
      })
    : [];
  // Once the trim runs out, lands are offered together (the land step); after them, or when the player passes on them,
  // the rest of the deck is dealt until it is at 100.
  const landStep = !landsPassed && lands.some((land) => land.left > 0);
  const lastResortIds = landStep ? [] : lastResortCuts({ cards: roomCards, roles: roleRows, cutScores, spared });
  const fromTrim = new Set<CardId>(trimIds);
  const trimQueue: CardSummary[] = [...new Set([...trimIds, ...lastResortIds])]
    .map((id) => journey.cards.get(id))
    .filter((card): card is CardSummary => card !== undefined);

  /**
   * Why a trimmed card is offered: its cut reasons when it has them, else the over-full role it fills. A last-resort
   * card says the deck is still over 100.
   */
  function trimCaption(card: CardSummary): string {
    const reasons = reasonsFor.get(card.id);
    if (reasons && reasons.length > 0) return reasonText(reasons);
    if (!fromTrim.has(card.id)) return "The deck is still over 100. Cut this, or keep it and see the next one.";
    const own = trim?.cardRoles[card.id] ?? [];
    const over = roles.find((r) => own.includes(r.key) && r.value > r.target);
    return over ? `The deck runs ${over.value} ${over.label.toLowerCase()}; about ${Math.round(over.target)} is typical.` : "Its job is one the deck already has plenty of.";
  }

  const finishLabel = "Next: fix";
  const landsTally = landsLine ? `${landsLine.value} lands; about ${Math.round(landsLine.target)} is typical.` : "";

  const status =
    owed > 0
      ? `Cut ${owed} to get back to 100${undecided.length > 0 ? `, starting with ${undecided.length} that break${undecided.length === 1 ? "s" : ""} a rule` : ""}.`
      : state.cuts.length > 0
        ? "Back at 100."
        : "The deck is at 100. Nothing needs cutting.";
  const statusLine = <StepStatus count={`${size} / ${COMMANDER_DECK_SIZE}`}>{status}</StepStatus>;
  const landCuts = (shown: readonly LandCount[], label: string) => <LandCuts lands={shown} label={label} onCut={take} onRestore={restore} />;

  if (view === "list") {
    // The first trims the deck owes are captioned, so the list says where to start.
    const suggested = new Set<number>(trimQueue.slice(0, trimOwed).map((c) => c.id));
    return (
      <div className="flex flex-col gap-3">
        <PhaseIntro title="Cut">
          Crossed-out cards break a rule for this deck. Tap any card to cut it, or a crossed-out one to keep it. Basic
          lands count down with − and +. Cut stops at 100.
        </PhaseIntro>
        {statusLine}
        {basics.length > 0 && (
          <section aria-labelledby="cut-basic-lands" className="flex flex-col gap-2">
            <h3 id="cut-basic-lands" className="font-heading text-xl leading-none font-semibold">
              Basic lands
            </h3>
            {landCuts(basics, "Basic lands")}
          </section>
        )}
        <DeckGroupsPanel
          deckGroups={deckGroups}
          selectedCardId={null}
          onSelectCard={(id) => {
            const card = journey.cards.get(id);
            if (card) toggle(card);
          }}
          markFor={(card: CardSummary) => (isMarked(card) ? "cut" : undefined)}
          captionFor={(card: CardSummary) => {
            const copiesCut = cutCopies(card.id);
            if (copiesCut > 0 && !isMarked(card)) {
              return (
                <span className="inline-flex items-center gap-1 font-semibold text-cut">
                  <Scissors aria-hidden className="size-3.5" />
                  {copiesCut} cut · {copiesLeft(card.id)} left
                </span>
              );
            }
            const combo = pieces.get(card.id);
            if (mandatoryIds.has(card.id)) {
              const reasons = reasonsFor.get(card.id) ?? [];
              const text = <span className="font-semibold text-cut">{shownReasons(reasons).map((reason) => cutReasonShortLabel[reason]).join(", ")}</span>;
              return combo ? <span className="flex flex-col gap-0.5"><ComboWarning result={combo} />{text}</span> : text;
            }
            if (combo) return <ComboWarning result={combo} />;
            return suggested.has(card.id) && !isMarked(card) ? <span className="font-semibold">Suggested trim</span> : undefined;
          }}
        />
        <NextBar label={owedAfterRuleBreaks > 0 ? `Cut ${owedAfterRuleBreaks} more first` : finishLabel} onNext={finish} disabled={owedAfterRuleBreaks > 0}>
          {size} / {COMMANDER_DECK_SIZE}
        </NextBar>
      </div>
    );
  }

  const mandatoryNext = undecided[0];
  const trimNext = trimOwed > 0 ? trimQueue[0] : undefined;
  const next = mandatoryNext?.card ?? trimNext;
  const cutCount = state.cuts.length;

  return (
    <div className="flex flex-col gap-3">
      <PhaseIntro title="Cut" brief="Swipe right to cut, left to keep.">
        Cards that break a rule, then the weakest cards in the roles the deck has too much of, until the deck is at 100.
      </PhaseIntro>
      {statusLine}
      {next ? (
        <SingleSwipe
          card={next}
          position={cutCount + 1}
          total={cutCount + undecided.length + Math.min(trimOwed, trimQueue.length)}
          label="Cards to cut"
          tone="cut"
          previewAs="remove"
          // ✂ cuts the card; ✓ keeps it. A ✓ on the cut side read as "keep" and the ✕ as "remove".
          acceptIcon={Scissors}
          passIcon={Check}
          upcoming={[...undecided.slice(1).map((sug) => sug.card.id), ...trimQueue.slice(0, PREFETCH_CARDS).map((c) => c.id)]}
          acceptLabel={`Cut ${next.name}`}
          passLabel={`Keep ${next.name}`}
          acceptWord="Cut"
          passWord="Keep"
          caption={withWarning(next, mandatoryNext ? reasonText(mandatoryNext.reasons) : trimCaption(next))}
          onAccept={() => take(next)}
          onPass={() => journey.dispatch({ type: "keep", cardId: next.id })}
          footer={
            // Moving on needs the deck at 100, so the way out appears once the cuts on the table get it there.
            owedAfterRuleBreaks === 0 ? (
              <Button type="button" size="sm" variant="link" onClick={finish}>
                {undecided.length > 0 ? "Cut the rest and move on" : "Done cutting: go to Fix"}
              </Button>
            ) : undefined
          }
        />
      ) : owed > 0 && landStep ? (
        <section aria-labelledby="cut-lands" className="flex flex-col gap-3 rounded-xl border border-seam bg-sleeve/60 p-4">
          <div>
            <h3 id="cut-lands" className="font-heading text-xl font-semibold">
              CUT Lands?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {owed} over 100. {landsTally}
            </p>
          </div>
          {/* Above the lands, which run long: passing on them shouldn't take a scroll past every one. */}
          <Button type="button" size="lg" variant="outline" onClick={() => setLandsPassed(true)}>
            CUT Nonland cards
          </Button>
          {landCuts(lands, "Lands")}
        </section>
      ) : owed > 0 ? (
        <SwipeDone
          title="You kept every card left"
          message={`The deck is at ${size}. Fix and Swap trade one card for one, so the deck has to be at 100 first: pick ${owed} more from the list.`}
        >
          <Button type="button" size="lg" onClick={onShowList}>
            Pick from the list
          </Button>
        </SwipeDone>
      ) : (
        <SwipeDone
          title={cutCount > 0 ? "Back at 100" : "Nothing needs cutting"}
          message={
            cutCount > 0
              ? `${cutCount} card${s(cutCount)} cut. Next, fix the lines Deck stats shows as off.`
              : "The deck is at 100. Next, fix the lines Deck stats shows as off."
          }
        >
          <Button type="button" size="lg" onClick={finish}>
            {finishLabel}
          </Button>
        </SwipeDone>
      )}
    </div>
  );
}
