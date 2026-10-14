"use client";

import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { AddSuggestion, CardSummary } from "@mtg/core/contract";
import type { StatLine } from "@mtg/core/journey";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { PHONE_HIT_AREA, PILL_OFF, PILL_ON } from "@/lib/constants";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { OwnedBadge } from "../card-label";
import { PanelError, PanelLoading } from "../panel-state";
import { NextBar, PhaseIntro, StepStatus } from "./journey-stepper";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import { SlotTray } from "./slot-tray";
import type { AddFilter, DeckJourney } from "./use-deck-journey";

/** How many suggestions the list view shows at once; the rest follow as these are added or skipped. */
const LIST_SUGGESTIONS = 18;
/** Cards after the one on screen whose rules text is fetched ahead, so it's there when they're dealt. */
const PREFETCH_CARDS = 4;

/** Why a suggestion is here, in one or two short lines. */
function Why({ suggestion }: { suggestion: AddSuggestion }) {
  const { card, fillsRoles, corpus, owned } = suggestion;
  return (
    <span className="flex flex-col items-start gap-0.5">
      {owned && <OwnedBadge />}
      {fillsRoles.length > 0 && <span className="font-semibold text-add">Adds {fillsRoles.map((r) => r.label.toLowerCase()).join(", ")}</span>}
      {corpus && (
        <span className="font-mono">{corpus.limited ? "New card, little play data yet" : `In ${formatPercent(corpus.inclusionRate)} of decks`}</span>
      )}
      <span className="font-mono">{card.price ? `About ${formatUsd(card.price.usd)}` : "No price"}</span>
    </span>
  );
}

/** "protection (3 of 8)": a short role as the status line names it. */
const shortfall = (role: StatLine) => `${role.label.toLowerCase()} (${role.value} of ${Math.round(role.target)})`;

/** The status line: what the deck is light on, and that Cut trims back to 100 after. */
function statusText(short: readonly StatLine[], room: number, cutsOwed: number): string {
  if (room === 0) return `That's as many as one round adds. Next, cut ${cutsOwed} to get back to 100.`;
  const light = short.length > 0 ? `Light on ${short.slice(0, 2).map(shortfall).join(" and ")}. ` : "";
  return `${light}Add what the deck needs; you'll trim back to 100 next.`;
}

/** Narrows Add to one short role, or shows every suggestion: blue pills, the chosen one solid. */
function RolePills({ short, filter, onChange }: { short: readonly StatLine[]; filter: AddFilter | null; onChange: (filter: AddFilter | null) => void }) {
  if (short.length === 0) return null;
  const pill = (pressed: boolean) =>
    cn(PHONE_HIT_AREA, "shrink-0 rounded-full border px-3 py-1 text-sm font-semibold whitespace-nowrap transition-colors", pressed ? PILL_ON : PILL_OFF);
  return (
    <div role="group" aria-label="Show suggestions for" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
      <button type="button" aria-pressed={filter === null} className={pill(filter === null)} onClick={() => onChange(null)}>
        All
      </button>
      {short.map((role) => {
        const pressed = filter?.kind === "role" && filter.roleId === role.key;
        return (
          <button
            key={role.key}
            type="button"
            aria-pressed={pressed}
            className={pill(pressed)}
            onClick={() => onChange(pressed ? null : { kind: "role", roleId: role.key, label: role.label })}
          >
            {role.label} <span className="font-mono font-normal">{role.value}/{Math.round(role.target)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Add, the first step: cards decks like this one run and it doesn't, best first, led by the roles it is short of.
 * Adding may take the deck past 100 (up to ADD_OVERFLOW_MAX); Cut then trims it back, starting with what it has too
 * much of. Adding one asks for the list again, because the card just added may fill the gap the next ones were
 * suggested for. Skipping just moves on.
 *
 * The role pills (and "Find …" in Deck stats) narrow the list to one short role; "All" puts the whole list back.
 */
export function AddPhase({ journey, view, roles }: { journey: DeckJourney; view: "swipe" | "list"; roles: readonly StatLine[] }) {
  const { state: addState, queue, shown, filter, setFilter, landsShort, accept, pass, undo } = journey.add;
  const onClearFilter = () => setFilter(null);
  const adds = journey.state?.adds ?? [];
  const open = journey.openSlots;
  const room = journey.roomToAdd;
  const cutsOwed = journey.cutsNeeded;
  const size = COMMANDER_DECK_SIZE - open + cutsOwed;
  // This round's additions plus the holes a short deck came in with.
  const slots = open + adds.length;
  const short = roles.filter((r) => !r.ok && r.value < r.target);
  const toCut = () => journey.goTo("cut");
  const nextLabel = cutsOwed > 0 ? `Next: cut ${cutsOwed}` : "Next: cut";
  const asOf = queue.find((s) => s.card.price)?.card.price?.asOf;
  const filterName = filter ? (filter.kind === "lands" ? "lands" : filter.label.toLowerCase()) : null;

  const intro = (
    <PhaseIntro title="Add" brief={view === "swipe" && room > 0 ? "Swipe right to add, left to skip." : undefined}>
      Cards decks like yours run and this one doesn&apos;t, best first{landsShort ? ", lands first while the mana base is short" : ""}. Each card you add
      changes what&apos;s suggested next.
    </PhaseIntro>
  );

  const body = (() => {
    if (room === 0) {
      return (
        <SwipeDone title="That's plenty for one round" message={`The deck is at ${size}. Next, cut it back to 100, starting with what it has too much of.`}>
          <Button type="button" size="lg" onClick={toCut}>
            {nextLabel}
          </Button>
        </SwipeDone>
      );
    }
    if (addState.status === "loading" || addState.status === "idle") return <PanelLoading label="Finding cards to add" />;
    if (addState.status === "error") return <PanelError message={addState.message} />;
    if (queue.length === 0) {
      return (
        <SwipeDone title="That's every suggestion for now" message="Go on to Cut, or come back after a swap or two for fresh ideas.">
          <Button type="button" size="lg" onClick={toCut}>
            {nextLabel}
          </Button>
        </SwipeDone>
      );
    }
    if (shown.length === 0) {
      return (
        <SwipeDone title={`No ${filterName} to suggest right now`} message="Every suggestion for it is already in the deck or skipped.">
          <Button type="button" size="lg" onClick={onClearFilter}>
            Show all
          </Button>
        </SwipeDone>
      );
    }

    if (view === "list") {
      return (
        <PocketGrid
          zoomable
          label="Cards to add"
          onSelect={(card: CardSummary) => accept(card)}
          items={shown.slice(0, LIST_SUGGESTIONS).map((s) => ({ card: s.card, caption: <Why suggestion={s} /> }))}
        />
      );
    }

    const next = shown[0]!;
    return (
      <SingleSwipe
        card={next.card}
        position={adds.length + 1}
        total={adds.length + Math.min(room, shown.length)}
        label="Cards to add"
        tone="add"
        upcoming={shown.slice(1, PREFETCH_CARDS + 1).map((s) => s.card.id)}
        acceptLabel={`Add ${next.card.name}`}
        passLabel={`Skip ${next.card.name}`}
        acceptWord="Add"
        passWord="Skip"
        caption={<Why suggestion={next} />}
        onAccept={() => accept(next.card)}
        onPass={() => pass(next.card)}
        footer={
          <Button type="button" size="sm" variant="link" onClick={toCut}>
            Done adding: {nextLabel.replace("Next: ", "")}
          </Button>
        }
      />
    );
  })();

  return (
    <div className="flex flex-col gap-3">
      {intro}
      <StepStatus count={`${size} / ${COMMANDER_DECK_SIZE}`}>{statusText(short, room, cutsOwed)}</StepStatus>
      {room > 0 && <RolePills short={short} filter={filter} onChange={setFilter} />}
      {slots > 0 && <SlotTray slots={slots} adds={adds} onTakeOut={undo} />}
      {body}
      {asOf && room > 0 && <p className="text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(asOf)}.</p>}
      {view === "list" && (
        <NextBar label={nextLabel} onNext={toCut}>
          {adds.length} added
        </NextBar>
      )}
    </div>
  );
}
