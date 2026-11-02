"use client";

import { TriangleAlert } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { AddSuggestion, CardSummary } from "@mtg/core/contract";
import type { StatLine } from "@mtg/core/journey";
import { cn } from "cn";
import type { Route } from "next";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { PHONE_HIT_AREA, PILL_OFF, PILL_ON, TEXT_LINK } from "@/lib/constants";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { PanelError, PanelLoading } from "../panel-state";
import { CombosPhase } from "./combos-phase";
import { NextBar, PhaseIntro, StepStatus } from "./journey-stepper";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import { AddsCounter, SlotTray } from "./slot-tray";
import type { AddFilter, DeckJourney } from "./use-deck-journey";

/** How many suggestions the list view shows at once; the rest follow as these are added or skipped. */
const LIST_SUGGESTIONS = 18;
/** Cards after the one on screen whose rules text is fetched ahead, so it's there when they're dealt. */
const PREFETCH_CARDS = 4;

/**
 * The roles a suggestion fills, as the counts it moves: "protection: 3 → 4 of 8". Read from the card's tracked roles
 * against Deck stats' lines, for the lines still short of their target (the ones the server picked it for); without the
 * card's roles, the role names the server gave.
 */
function fills({ card, fillsRoles }: AddSuggestion, roles: readonly StatLine[]): string | null {
  const moved = card.roles
    ? roles
        .filter((role) => card.roles?.includes(role.key) && role.value < role.target)
        .map((role) => `${role.label.toLowerCase()}: ${role.value} → ${role.value + 1} of ${Math.round(role.target)}`)
    : [];
  const named = moved.length > 0 ? moved : fillsRoles.map((r) => r.label.toLowerCase());
  return named.length > 0 ? `Adds ${named.join(", ")}` : null;
}

/**
 * Why a suggestion is here, in one or two short lines. With a collection, an owned card shows as owned and only the
 * others show a price, so a price reads as a card to buy.
 */
function Why({ suggestion, roles, hasCollection }: { suggestion: AddSuggestion; roles: readonly StatLine[]; hasCollection: boolean }) {
  const { card, corpus, owned } = suggestion;
  const adds = fills(suggestion, roles);
  return (
    <span className="flex flex-col items-start gap-0.5">
      {adds && <span className="font-semibold text-add">{adds}</span>}
      {corpus && (
        <span className="font-mono">{corpus.limited ? "New card, little play data yet" : `In ${formatPercent(corpus.inclusionRate)} of decks`}</span>
      )}
      {!(hasCollection && owned) && <span className="font-mono">{card.price ? `About ${formatUsd(card.price.usd)}` : "No price"}</span>}
    </span>
  );
}

/**
 * Add ran out with the deck under 100 (T076). Kept to the collection, it first offers cards the player doesn't own;
 * after that, or when the player keeps to owned cards, a warning offers basic lands for the holes.
 */
function RunOut({
  journey,
  open,
  onCut,
  nextLabel,
  onShowUnowned,
}: {
  journey: DeckJourney;
  open: number;
  onCut: () => void;
  nextLabel: string;
  /** Allow Singles: switches the collection setting to Owned first, so Add suggests cards the player doesn't own too. */
  onShowUnowned: () => void;
}) {
  const { collectionOnly, keptToOwned, keepToOwned, fillBasics, basicsFill } = journey.add;
  if (collectionOnly && !keptToOwned) {
    return (
      <SwipeDone title="Insufficient Collection" message="You don't have a large enough collection.">
        <Button type="button" size="lg" onClick={onShowUnowned}>
          Allow Singles
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={keepToOwned}>
          Owned only
        </Button>
      </SwipeDone>
    );
  }
  const adding = basicsFill.status === "loading";
  return (
    <SwipeDone
      title={
        <span className="inline-flex items-center gap-2">
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-warning" />
          {open} open
        </span>
      }
      message={collectionOnly ? "No more owned cards to suggest. Fill the holes with basics?" : "No more cards to suggest. Fill the holes with basics?"}
    >
      <Button type="button" size="lg" disabled={adding} onClick={() => void fillBasics()}>
        {adding ? "Adding basics…" : `Add ${open} ${open === 1 ? "basic" : "basics"}`}
      </Button>
      {collectionOnly && (
        <Button type="button" size="lg" variant="outline" onClick={onShowUnowned}>
          Allow Singles
        </Button>
      )}
      <Button type="button" size="lg" variant="link" onClick={onCut}>
        {nextLabel}
      </Button>
      {basicsFill.status === "error" && <ErrorText className="w-full justify-center">{basicsFill.message}</ErrorText>}
    </SwipeDone>
  );
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
export function AddPhase({
  journey,
  view,
  roles,
  onShowUnowned,
  uploadHref,
}: {
  journey: DeckJourney;
  view: "swipe" | "list";
  roles: readonly StatLine[];
  onShowUnowned: () => void;
  /** Where Combos' "Upload a collection" goes: sign-in first when signed out, then the import. */
  uploadHref: Route;
}) {
  const { state: addState, queue, shown, filter, setFilter, landsShort, accept, pass, undo } = journey.add;
  const onClearFilter = () => setFilter(null);
  const adds = journey.state?.adds ?? [];
  const open = journey.openSlots;
  const room = journey.roomToAdd;
  const cutsOwed = journey.cutsNeeded;
  const size = COMMANDER_DECK_SIZE - open + cutsOwed;
  // The bottom prompt on to Cut shows once the deck is full (100 or more).
  const full = size >= COMMANDER_DECK_SIZE;
  // This round's additions plus the holes a short deck came in with.
  const slots = open + adds.length;
  const short = roles.filter((r) => !r.ok && r.value < r.target);
  // Through the stepper, so a deck under 100 asks before it goes.
  // Add's own way on: through Combos when there are any (the stepper's Cut jumps straight there).
  const toCut = journey.add.next;
  const cutLabel = cutsOwed > 0 ? `Next: cut ${cutsOwed}` : "Next: cut";
  const combos = journey.add.combos;
  // Next goes through Combos when there are any.
  const nextLabel = combos.length > 0 ? "Next: combos" : cutLabel;
  const hasCollection = journey.add.hasCollection;
  // Owned cards are marked only where they mix with cards to buy: in Owned only every card is owned.
  const markOwned = hasCollection && !journey.add.collectionOnly;
  // The as-of date goes with the prices on screen: with a collection, only cards not owned show one.
  const asOf = queue.find((s) => s.card.price && !(hasCollection && s.owned))?.card.price?.asOf;
  const filterName = filter ? (filter.kind === "lands" ? "lands" : filter.label.toLowerCase()) : null;

  if (journey.add.part === "combos") return <CombosPhase journey={journey} uploadHref={uploadHref} nextLabel={cutLabel} />;

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
      if (open > 0) return <RunOut journey={journey} open={open} onCut={toCut} nextLabel={nextLabel} onShowUnowned={onShowUnowned} />;
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
        <div className="flex flex-col gap-6">
          <PocketGrid
            zoomable
            label="Cards to add"
            onSelect={(card: CardSummary) => accept(card)}
            items={shown.slice(0, LIST_SUGGESTIONS).map((s) => ({ card: s.card, owned: markOwned && s.owned !== null, caption: <Why suggestion={s} roles={roles} hasCollection={hasCollection} /> }))}
          />
        </div>
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
        previewAs="add"
        upcoming={shown.slice(1, PREFETCH_CARDS + 1).map((s) => s.card.id)}
        acceptLabel={`Add ${next.card.name}`}
        passLabel={`Skip ${next.card.name}`}
        acceptWord="Add"
        passWord="Skip"
        caption={<Why suggestion={next} roles={roles} hasCollection={hasCollection} />}
        owned={markOwned && next.owned !== null}
        onAccept={() => accept(next.card)}
        onPass={() => pass(next.card)}
        footer={
          full && (
            <Button type="button" size="sm" variant="link" onClick={toCut}>
              Done adding: {nextLabel.replace("Next: ", "")}
            </Button>
          )
        }
      />
    );
  })();

  return (
    <div className="flex flex-col gap-3">
      {intro}
      <StepStatus count={<AddsCounter count={`${size} / ${COMMANDER_DECK_SIZE}`} adds={adds} onTakeOut={undo} />}>
        {combos.length > 0 && (
          <button type="button" onClick={journey.add.openCombos} className={cn(TEXT_LINK, PHONE_HIT_AREA, "text-sm")}>
            Combos ({combos.length})
          </button>
        )}
      </StepStatus>
      {room > 0 && <RolePills short={short} filter={filter} onChange={setFilter} />}
      {slots > 0 && <SlotTray slots={slots} adds={adds} onTakeOut={undo} />}
      {body}
      {asOf && room > 0 && <p className="text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(asOf)}.</p>}
      {view === "list" && full && (
        <NextBar label={nextLabel} onNext={toCut}>
          {adds.length} added
        </NextBar>
      )}
    </div>
  );
}
