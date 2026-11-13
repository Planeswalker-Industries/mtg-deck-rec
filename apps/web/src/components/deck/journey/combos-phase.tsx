"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, Library } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardId, ComboSuggestion } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { Button, buttonVariants } from "@/components/ui/button";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { formatAsOf, formatUsd } from "@/lib/format";
import { NextBar, PhaseIntro, StepStatus } from "./journey-stepper";
import type { DeckJourney } from "./use-deck-journey";

/** Commander Spellbook's home page, which the credit line links to. */
const SPELLBOOK_HOME = "https://commanderspellbook.com/";
/** Tailwind's sm breakpoint: from here up both sections start open; on phones the second waits, so Next stays near. */
const WIDE_QUERY = "(min-width: 40rem)";
const GRID_SIZES = "(min-width: 1024px) 160px, (min-width: 640px) 25vw, 33vw";

/** "via Sanguine Bond + Swords to Plowshares": the pieces already in the deck, then the ones Spellbook describes. */
const viaLine = (combo: ComboSuggestion, names: (id: CardId) => string) =>
  `via ${[...combo.pieceIds.map(names), ...combo.alsoNeeded].join(" + ")}`;

/** One combo: the card that finishes it, what it does, its pieces (linked to its Spellbook page), and Add Combo. */
function ComboEntry({
  combo,
  names,
  priced,
  canAdd,
  onAdd,
}: {
  combo: ComboSuggestion;
  names: (id: CardId) => string;
  /** Combo Upgrades show what the card costs; ready combos are owned, so they don't. */
  priced: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const result = combo.results[0] ?? "Combo";
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <ZoomableCard card={combo.card}>
        <CardImage card={combo.card} variant="small" alt={combo.card.name} sizes={GRID_SIZES} />
      </ZoomableCard>
      <span className="text-sm leading-tight font-semibold">{result}</span>
      <a
        href={combo.url}
        target="_blank"
        rel="noreferrer"
        className={cn(TEXT_LINK, PHONE_HIT_AREA, "w-fit text-xs leading-snug")}
      >
        {viaLine(combo, names)}
      </a>
      {priced && <span className="font-mono text-xs">{combo.card.price ? `About ${formatUsd(combo.card.price.usd)}` : "No price"}</span>}
      <Button type="button" size="sm" className="mt-auto w-full" disabled={!canAdd} onClick={onAdd} aria-label={`Add ${combo.card.name}, completes ${result}`}>
        Add Combo
      </Button>
    </li>
  );
}

/** A collapsible section of combos: its heading and count are the summary, a rotating chevron says which way it goes. */
function ComboSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className="group rounded-panel border border-seam bg-sleeve">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-primary [&::-webkit-details-marker]:hidden">
        <h3 className="font-heading text-lg leading-none font-semibold text-foreground">
          {title} {count !== undefined && <span className="font-mono text-base font-normal text-muted-foreground">{count}</span>}
        </h3>
        <ChevronDown aria-hidden className="size-5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function ComboGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-3 gap-x-2 gap-y-5 @md:grid-cols-4 @xl:grid-cols-5 @3xl:grid-cols-6">{children}</ul>
    </div>
  );
}

/**
 * Add's second part: combos the deck is one card short of. Collection Ready Combos are the ones whose missing card the
 * player owns; Combo Upgrades need a card bought. Without a collection, the first section is the way to upload one.
 * Reached from Add's Next, its Combos link and Deck stats; the stepper still says Add.
 */
export function CombosPhase({ journey, uploadHref, nextLabel }: { journey: DeckJourney; uploadHref: Route; nextLabel: string }) {
  const { combos, acceptCombo, hasCollection, showCards, toNext } = journey.add;
  const [readyOpen, setReadyOpen] = useState(true);
  // Combos only ever render in the browser (after a deck is read), so the window is there to ask.
  const [upgradesOpen, setUpgradesOpen] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const names = (id: CardId) => journey.cards.get(id)?.name ?? "Unknown card";
  const room = journey.openSlots;
  const size = COMMANDER_DECK_SIZE - journey.openSlots;
  const ready = hasCollection ? combos.filter((c) => c.owned !== null) : [];
  const upgrades = hasCollection ? combos.filter((c) => c.owned === null) : combos;
  const asOf = upgrades.find((c) => c.card.price)?.card.price?.asOf;
  const entries = (list: readonly ComboSuggestion[], priced: boolean) => (
    <ComboGrid>
      {list.map((combo) => (
        <ComboEntry
          key={combo.id}
          combo={combo}
          names={names}
          priced={priced}
          canAdd={room > 0}
          onAdd={() => acceptCombo(combo.card)}
        />
      ))}
    </ComboGrid>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <PhaseIntro title="Combos">Cards that finish a combo your deck is one card short of.</PhaseIntro>
        <button type="button" onClick={showCards} className={cn(TEXT_LINK, PHONE_HIT_AREA, "shrink-0 text-sm")}>
          Back to cards
        </button>
      </div>
      <StepStatus count={`${size} / ${COMMANDER_DECK_SIZE}`} />
      <p className="text-xs text-muted-foreground">
        via{" "}
        <a href={SPELLBOOK_HOME} target="_blank" rel="noreferrer" className={TEXT_LINK}>
          Commander Spellbook
        </a>
      </p>
      {room === 0 && <p className="text-sm">The deck is at 100, so there is no room for another card here.</p>}

      {hasCollection ? (
        <ComboSection title="Collection Ready Combos" count={ready.length} open={readyOpen} onToggle={setReadyOpen}>
          {ready.length > 0 ? entries(ready, false) : <p className="text-sm text-muted-foreground">None of your cards finish a combo for this deck yet.</p>}
        </ComboSection>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-panel border border-dashed border-seam p-4">
          <p className="text-sm">Upload a collection to see the combos you can make from cards you own.</p>
          <Link href={uploadHref} className={buttonVariants({ variant: "outline", className: "gap-2" })}>
            <Library aria-hidden className="size-4" />
            Upload a collection
          </Link>
        </div>
      )}

      <ComboSection title="Combo Upgrades" count={upgrades.length} open={upgradesOpen} onToggle={setUpgradesOpen}>
        {upgrades.length > 0 ? (
          <>
            {entries(upgrades, true)}
            {asOf && <p className="mt-4 text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(asOf)}.</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No combos to buy into for this deck.</p>
        )}
      </ComboSection>

      <NextBar label={nextLabel} onNext={toNext}>
        {combos.length} {combos.length === 1 ? "combo" : "combos"}
      </NextBar>
    </div>
  );
}
