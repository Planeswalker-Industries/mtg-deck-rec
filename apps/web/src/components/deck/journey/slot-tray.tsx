"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { displayName } from "@/lib/cards";

/** A card dropped into its slot settles from slightly above and larger, so the player sees where it went. */
const DROP = { fromY: -10, fromScale: 1.12, seconds: 0.28 } as const;
/** Empty sleeves drawn after the added cards; the rest fold into a count, so a short deck can't push the swipe down. */
const EMPTY_SLOTS_SHOWN = 8;

/**
 * The holes the cuts left in the deck: one sleeve per cut, filled left to right as cards are added. An empty sleeve is
 * a dashed outline; a filled one shows the card, and tapping it takes the card back out. Past
 * EMPTY_SLOTS_SHOWN the empty sleeves fold into a count. Hidden on phones, where the step's "17 / 100" counter says the
 * same and every row counts toward keeping the swipe buttons on screen; Undo takes an add back there.
 */
export function SlotTray({ slots, adds, onTakeOut }: { slots: number; adds: readonly CardSummary[]; onTakeOut: (card: CardSummary) => void }) {
  const reduceMotion = useReducedMotion();
  const empty = Math.max(0, slots - adds.length);
  const emptyShown = Math.min(empty, EMPTY_SLOTS_SHOWN);

  return (
    <section aria-label="Slots to fill" className="flex flex-col gap-1.5 max-sm:hidden">
      <ul className="flex flex-wrap gap-1.5">
        {adds.map((card) => (
          <motion.li
            key={card.id}
            initial={reduceMotion ? false : { y: DROP.fromY, scale: DROP.fromScale, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            transition={{ duration: DROP.seconds, ease: "easeOut" }}
            className="w-12"
          >
            <button
              type="button"
              aria-label={`Take ${displayName(card)} back out`}
              onClick={() => onTakeOut(card)}
              className="block w-full rounded-[4.75%/3.4%] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <CardImage card={card} variant="small" alt="" sizes="48px" className="shadow-[0_0_0_1.5px_var(--add),0_0_10px_color-mix(in_oklch,var(--add),transparent_50%)]" />
            </button>
          </motion.li>
        ))}
        {Array.from({ length: emptyShown }, (_, i) => (
          <li key={`empty-${i}`} className="w-12">
            <span className="block aspect-[488/680] w-full rounded-[4.75%/3.4%] border border-dashed border-add/50 bg-add/5">
              <span className="sr-only">Open slot</span>
            </span>
          </li>
        ))}
        {empty > emptyShown && (
          <li className="flex items-center px-1 font-mono text-sm text-muted-foreground">
            +{empty - emptyShown}
            <span className="sr-only"> more open slots</span>
          </li>
        )}
      </ul>
      {adds.length > 0 && <p className="text-xs text-muted-foreground">Tap an added card to take it back out.</p>}
    </section>
  );
}
