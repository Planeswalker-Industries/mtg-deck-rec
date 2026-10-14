"use client";

import { Check, Scissors } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, CardSummary, CutReason, CutResult } from "@mtg/core/contract";
import { trimCuts, type StatLine } from "@mtg/core/journey";
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
 * of. Swiping deals them one at a time (✂ cut, ✓ keep) until the deck is at 100. The list shows the whole deck with the
 * cuts crossed out; tapping any card marks or unmarks it.
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
  const { recommended, undecided, isMarked, toggle, finish } = journey.cut;
  const focus = trim?.focus ?? null;

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

  const trimQueue: CardSummary[] = trim
    ? trimCuts({
        cards: deck.cards
          .filter((entry) => entry.section === "main" && !mandatoryIds.has(entry.cardId))
          .flatMap((entry) => {
            const card = journey.cards.get(entry.cardId);
            return card ? [{ id: card.id, isLand: isFrontLand(card.typeLine), manaValue: card.manaValue, roles: trim.cardRoles[card.id] ?? [] }] : [];
          }),
        roles: roleRows,
        landsOver: landsLine ? !landsLine.ok && landsLine.value > landsLine.target : false,
        cutScores: new Map(cutState.data.suggestions.map((sug) => [sug.card.id, sug.cutScore])),
        spared,
        focusRoleId: focus?.roleId ?? null,
      })
        .map((id) => journey.cards.get(id))
        .filter((card): card is CardSummary => card !== undefined)
    : [];

  const focusRow = focus ? roles.find((r) => r.key === focus.roleId) : undefined;
  // Deck stats re-tallies as cards go, so what the focus role is still over by is read live.
  const focusLeft = focusRow ? Math.max(0, Math.floor(focusRow.value - focusRow.target)) : 0;
  const trimsToDeal = focus ? focusLeft : trimOwed;

  /** Why a trimmed card is offered: its cut reasons when it has them, else the over-full role it fills. */
  function trimCaption(card: CardSummary): string {
    const reasons = reasonsFor.get(card.id);
    if (reasons && reasons.length > 0) return reasonText(reasons);
    const own = trim?.cardRoles[card.id] ?? [];
    const over = roles.find((r) => own.includes(r.key) && r.value > r.target);
    return over ? `The deck runs ${over.value} ${over.label.toLowerCase()}; about ${Math.round(over.target)} is typical.` : "Its job is one the deck already has plenty of.";
  }

  const status = focus
    ? `Trimming ${focus.label.toLowerCase()}: ${focusRow?.value ?? 0} in the deck, about ${Math.round(focusRow?.target ?? 0)} is typical.`
    : owed > 0
      ? `Cut ${owed} to get back to 100${undecided.length > 0 ? `, starting with ${undecided.length} that break${undecided.length === 1 ? "s" : ""} a rule` : ""}.`
      : undecided.length > 0
        ? `${undecided.length} card${s(undecided.length)} here break${undecided.length === 1 ? "s" : ""} a rule for this deck.`
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

  if (view === "list") {
    // The first trims the deck owes are captioned, so the list says where to start.
    const suggested = new Set<number>(trimQueue.slice(0, trimsToDeal).map((c) => c.id));
    return (
      <div className="flex flex-col gap-3">
        <PhaseIntro title="Cut">
          Crossed-out cards break a rule for this deck. Tap any card to cut it, or a crossed-out one to keep it.
        </PhaseIntro>
        {statusLine}
        <DeckGroupsPanel
          deckGroups={deckGroups}
          selectedCardId={null}
          onSelectCard={(id) => {
            const card = journey.cards.get(id);
            if (card) toggle(card);
          }}
          markFor={(card: CardSummary) => (isMarked(card) ? "cut" : undefined)}
          captionFor={(card: CardSummary) => {
            if (mandatoryIds.has(card.id)) {
              const reasons = reasonsFor.get(card.id) ?? [];
              return <span className="font-semibold text-cut">{shownReasons(reasons).map((reason) => cutReasonShortLabel[reason]).join(", ")}</span>;
            }
            return suggested.has(card.id) && !isMarked(card) ? <span className="font-semibold">Suggested trim</span> : undefined;
          }}
        />
        <NextBar label="Next: swaps" onNext={finish}>
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
            <Button type="button" size="sm" variant="link" onClick={finish}>
              {undecided.length > 0 ? "Cut the rest and move on" : "Done cutting: go to swaps"}
            </Button>
          }
        />
      ) : owed > 0 && !focus ? (
        <SwipeDone
          title="Nothing obvious left to cut"
          message={`The deck is at ${size}. Pick ${owed} more from the list, or go on and fix it later.`}
        >
          <Button type="button" size="lg" onClick={onShowList}>
            Pick from the list
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={finish}>
            Next: swaps
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
          <Button type="button" size="lg" onClick={finish}>
            Next: swaps
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={onShowList}>
            Cut cards anyway
          </Button>
        </SwipeDone>
      )}
    </div>
  );
}
