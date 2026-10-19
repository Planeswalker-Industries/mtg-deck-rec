"use client";

import { useState } from "react";
import { Check, Scissors } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary, CutReason, CutResult } from "@mtg/core/contract";
import { lastResortCuts, trimCuts, type RoomCard, type StatLine } from "@mtg/core/journey";
import { isFrontLand } from "@mtg/core/scoring";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
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

/** The role Deck stats asked Cut to trim ("Trim removal"). */
export interface TrimFocus {
  roleId: string;
  label: string;
}

/** What trimming reads from Deck stats: every stat line (lands too), and each analyzed card's tracked roles. */
export interface TrimInputs {
  stats: readonly StatLine[];
  cardRoles: Readonly<Record<number, readonly string[]>>;
  focus: TrimFocus | null;
  setFocus: (focus: TrimFocus | null) => void;
}

const s = (n: number) => (n === 1 ? "" : "s");

/**
 * Cut, after Add: bring the deck back to 100. Cards that break a rule come first (the cut list's mandatory ones); then
 * the trim (`trimCuts`): cards in the roles the deck has too much of, weakest first, never one filling a role it is short
 * of. Swiping deals them one at a time (✂ cut, ✓ keep). While the deck is still over 100 after that, Cut offers its lands
 * together, as −/+ counts, and then (or once the player passes on lands) deals the rest of the deck (`lastResortCuts`)
 * until it is at 100. The round can't go on to Swap over 100, and goes back to Add below it. The list shows the whole
 * deck with the cuts crossed out; tapping a card cuts it (a copy a tap for basic lands, which also get −/+ counts), and
 * tapping a crossed-out one puts it back.
 *
 * "Trim …" in Deck stats narrows the trim to one role, until that role is back on target.
 */
export function CutPhase({
  journey,
  cutState,
  view,
  deckGroups,
  trim,
  onShowList,
  onFinish,
}: {
  journey: DeckJourney;
  cutState: Async<CutResult>;
  view: "swipe" | "list";
  deckGroups: DeckGroups;
  /** Absent where Deck stats has no targets: then only the rule breaks are dealt. */
  trim?: TrimInputs;
  /** Switches to the list view, to cut any card by hand. */
  onShowList: () => void;
  /** Leaves Cut (to Swap, or back to Add below 100); the deck tool checks the land count first. */
  onFinish: () => void;
}) {
  const { recommended, undecided, isMarked, cutCopies, owed: owedAfterRuleBreaks, open, restore, toggle } = journey.cut;
  const focus = trim?.focus ?? null;
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
  const spared = new Set<CardId>([...state.kept, ...state.adds.map((c) => c.id)]);

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
        focusRoleId: focus?.roleId ?? null,
      })
    : [];
  // Once the trim runs out, lands are offered together (the land step); after them, or when the player passes on them,
  // the rest of the deck is dealt until it is at 100. Trimming one role stops when the role is on target instead.
  const landStep = !focus && !landsPassed && lands.some((land) => land.left > 0);
  const lastResortIds = focus || landStep ? [] : lastResortCuts({ cards: roomCards, roles: roleRows, cutScores, spared });
  const fromTrim = new Set<CardId>(trimIds);
  const trimQueue: CardSummary[] = [...new Set([...trimIds, ...lastResortIds])]
    .map((id) => journey.cards.get(id))
    .filter((card): card is CardSummary => card !== undefined);

  const focusRow = focus ? roles.find((r) => r.key === focus.roleId) : undefined;
  // Deck stats re-tallies as cards go, so what the focus role is still over by is read live.
  const focusLeft = focusRow ? Math.max(0, Math.floor(focusRow.value - focusRow.target)) : 0;
  const trimsToDeal = focus ? focusLeft : trimOwed;

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

  /** Where leaving Cut goes: back to Add while the deck is below 100 (Swap trades one for one), else on to Swap. */
  const finishLabel = open > 0 ? `Back to Add: ${open} to fill` : "Next: swaps";
  const landsTally = landsLine ? `It runs ${landsLine.value} lands; about ${Math.round(landsLine.target)} is typical.` : "";

  const status = focus
    ? `Trimming ${focus.label.toLowerCase()}: ${focusRow?.value ?? 0} in the deck, about ${Math.round(focusRow?.target ?? 0)} is typical.`
    : owed > 0
      ? `Cut ${owed} to get back to 100${undecided.length > 0 ? `, starting with ${undecided.length} that break${undecided.length === 1 ? "s" : ""} a rule` : ""}.`
      : undecided.length > 0
        ? `${undecided.length} card${s(undecided.length)} here break${undecided.length === 1 ? "s" : ""} a rule for this deck.`
        : open > 0
          ? `The deck is ${COMMANDER_DECK_SIZE - size} below 100. Add fills the open slots before Swap.`
          : size < COMMANDER_DECK_SIZE
            ? `The deck is ${COMMANDER_DECK_SIZE - size} below 100. Nothing needs cutting.`
          : state.cuts.length > 0
            ? "Back at 100."
            : "The deck is at 100. Nothing needs cutting.";
  const statusLine = (
    <StepStatus count={`${size} / ${COMMANDER_DECK_SIZE}`}>
      {status}
      {focus && (
        <>
          {" "}
          <button type="button" className={cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer")} onClick={() => trim?.setFocus(null)}>
            Stop trimming
          </button>
        </>
      )}
    </StepStatus>
  );
  const landCuts = (shown: readonly LandCount[], label: string) => (
    <LandCuts lands={shown} label={label} onCut={(card) => journey.dispatch({ type: "cut", card })} onRestore={restore} />
  );

  if (view === "list") {
    // The first trims the deck owes are captioned, so the list says where to start.
    const suggested = new Set<number>(trimQueue.slice(0, trimsToDeal).map((c) => c.id));
    return (
      <div className="flex flex-col gap-3">
        <PhaseIntro title="Cut">
          Crossed-out cards break a rule for this deck. Tap any card to cut it, or a crossed-out one to keep it. Basic
          lands count down with − and +.
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
            if (mandatoryIds.has(card.id)) {
              const reasons = reasonsFor.get(card.id) ?? [];
              return <span className="font-semibold text-cut">{shownReasons(reasons).map((reason) => cutReasonShortLabel[reason]).join(", ")}</span>;
            }
            return suggested.has(card.id) && !isMarked(card) ? <span className="font-semibold">Suggested trim</span> : undefined;
          }}
        />
        <NextBar
          label={owedAfterRuleBreaks > 0 ? `Cut ${owedAfterRuleBreaks} more first` : finishLabel}
          onNext={onFinish}
          disabled={owedAfterRuleBreaks > 0}
        >
          {size} / {COMMANDER_DECK_SIZE}
        </NextBar>
      </div>
    );
  }

  const mandatoryNext = undecided[0];
  const trimNext = trimsToDeal > 0 ? trimQueue[0] : undefined;
  const next = mandatoryNext?.card ?? trimNext;
  const cutCount = state.cuts.length;

  return (
    <div className="flex flex-col gap-3">
      <PhaseIntro title="Cut" brief="Swipe right to cut, left to keep.">
        Cards that break a rule, then the weakest cards in the roles the deck has too much of.
      </PhaseIntro>
      {statusLine}
      {next ? (
        <SingleSwipe
          card={next}
          position={cutCount + 1}
          total={cutCount + undecided.length + Math.min(trimsToDeal, trimQueue.length)}
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
          caption={mandatoryNext ? reasonText(mandatoryNext.reasons) : trimCaption(next)}
          onAccept={() => journey.dispatch({ type: "cut", card: next })}
          onPass={() => journey.dispatch({ type: "keep", cardId: next.id })}
          footer={
            // Moving on needs the deck at 100, so the way out appears once the cuts on the table get it there.
            owedAfterRuleBreaks === 0 ? (
              <Button type="button" size="sm" variant="link" onClick={onFinish}>
                {undecided.length > 0 ? "Cut the rest and move on" : "Done cutting: go to swaps"}
              </Button>
            ) : undefined
          }
        />
      ) : owed > 0 && landStep ? (
        <section aria-labelledby="cut-lands" className="flex flex-col gap-3 rounded-xl border border-seam bg-sleeve/60 p-4">
          <div>
            <h3 id="cut-lands" className="font-heading text-xl font-semibold">
              Make room with lands?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The deck is still {owed} over 100. {landsTally} Take a few out with −, or see other cards to cut.
            </p>
          </div>
          {/* Above the lands, which run long: passing on them shouldn't take a scroll past every one. */}
          <Button type="button" size="lg" variant="outline" onClick={() => setLandsPassed(true)}>
            Show other cards instead
          </Button>
          {landCuts(lands, "Lands")}
        </section>
      ) : owed > 0 && !focus ? (
        <SwipeDone
          title="You kept every card left"
          message={`The deck is at ${size}. Swap trades one card for one, so the deck has to be at 100 first: pick ${owed} more from the list.`}
        >
          <Button type="button" size="lg" onClick={onShowList}>
            Pick from the list
          </Button>
        </SwipeDone>
      ) : open > 0 && !focus ? (
        <SwipeDone
          title={`The deck is at ${size}`}
          message={`Swap trades one card for one, so fill the ${open} open slot${s(open)} in Add first.`}
        >
          <Button type="button" size="lg" onClick={onFinish}>
            Back to Add
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={onShowList}>
            Put cards back from the list
          </Button>
        </SwipeDone>
      ) : (
        <SwipeDone
          title={focus ? `${focus.label} trimmed` : size > COMMANDER_DECK_SIZE ? `The deck is at ${size}` : cutCount > 0 ? "Back to 100" : "Nothing needs cutting"}
          message={
            focus
              ? "Add something the deck is short of with the cards that opened, or go on to swaps."
              : cutCount > 0
                ? `${cutCount} card${s(cutCount)} cut. Next, swap weaker cards for better ones.`
                : recommended.length === 0
                  ? "Every card is legal here and the deck isn't over 100. Next, swap weaker cards for better ones."
                  : "Next, swap weaker cards for better ones."
          }
        >
          <Button type="button" size="lg" onClick={onFinish}>
            {finishLabel}
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={onShowList}>
            Cut cards anyway
          </Button>
        </SwipeDone>
      )}
    </div>
  );
}
