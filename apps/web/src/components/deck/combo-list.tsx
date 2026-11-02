"use client";

import type { CardId, CardSummary, ComboSuggestion } from "@mtg/core/contract";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";

/** Combos shown at once: "complete a combo" is a side dish, not a second list. */
const MAX_COMBOS_SHOWN = 6;

/**
 * "Complete a combo": cards that finish a Commander Spellbook combo the deck is one card short of. Each says what the
 * combo does, the pieces already there and any described pieces, and links the combo's Spellbook page (credit).
 * `onAdd` makes each card a press that adds it; without it the list only shows (the build view).
 */
export function ComboList({
  combos,
  names,
  onAdd,
  markOwned = false,
}: {
  combos: readonly ComboSuggestion[];
  /** Names for the pieces already in the deck. */
  names: (id: CardId) => string;
  onAdd?: ((card: CardSummary) => void) | undefined;
  /** Mark owned cards: only where owned and unowned cards mix. */
  markOwned?: boolean;
}) {
  if (combos.length === 0) return null;
  return (
    <section aria-labelledby="complete-a-combo" className="flex flex-col gap-2">
      <h2 id="complete-a-combo" className="font-heading text-xl leading-none font-semibold">
        Complete a combo
      </h2>
      <PocketGrid
        zoomable
        label="Complete a combo"
        {...(onAdd ? { onSelect: onAdd } : {})}
        items={combos.slice(0, MAX_COMBOS_SHOWN).map((combo) => ({
          card: combo.card,
          owned: markOwned && combo.owned !== null,
          caption: (
            <span className="flex flex-col items-start gap-0.5">
              <span className="font-semibold">{combo.results[0] ?? "Combo"}</span>
              <span className="text-muted-foreground">+ {[...combo.pieceIds.map(names), ...combo.alsoNeeded].join(", ")}</span>
            </span>
          ),
          // Outside the pocket: a link can't sit inside the pocket's button.
          footer: (
            <a href={combo.url} target="_blank" rel="noreferrer" className={cn(TEXT_LINK, PHONE_HIT_AREA, "px-1 text-xs")}>
              Commander Spellbook
            </a>
          ),
        }))}
      />
    </section>
  );
}
