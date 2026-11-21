"use client";

import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ClipboardList, Plus, Repeat2, Scissors, Wrench } from "lucide-react";
import type { JourneyPhase } from "@mtg/core/journey";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { PILL_OFF, PILL_ON } from "@/lib/constants";
import { StepStatusSlot } from "./round-bar";

/** Each step's name and icon. Steps are tabs drawn as outline buttons: the current one has a thicker espresso edge. */
const STEPS: Record<JourneyPhase, { name: string; Icon: typeof Scissors }> = {
  cut: { name: "Cut", Icon: Scissors },
  add: { name: "Add", Icon: Plus },
  fix: { name: "Fix", Icon: Wrench },
  replace: { name: "Swap", Icon: Repeat2 },
  review: { name: "Finish", Icon: ClipboardList },
};

/** A round runs three steps (a deck at 100) or four (Add or Cut first): the row's columns, spelled out for Tailwind. */
const STEP_COLUMNS: Readonly<Record<number, string>> = { 3: "grid-cols-3", 4: "grid-cols-4" };

/**
 * Where the player is in the journey. Earlier steps can be revisited, and the next step does what the current one's
 * Next does. A step further on opens only when the round has been there and nothing since changed what it shows
 * (`canOpen`), because each step asks for its suggestions against the choices made before it.
 */
export function JourneyStepper({
  phases,
  phase,
  canOpen,
  onSelect,
}: {
  /** The steps this round runs, in order (`phasesFor`). */
  phases: readonly JourneyPhase[];
  phase: JourneyPhase;
  canOpen: (phase: JourneyPhase) => boolean;
  onSelect: (phase: JourneyPhase) => void;
}) {
  const at = phases.indexOf(phase);
  return (
    <nav aria-label="Deck upgrade steps">
      <ol className={cn("grid gap-1.5", STEP_COLUMNS[phases.length] ?? "grid-cols-4")}>
        {phases.map((step, i) => {
          const { name, Icon } = STEPS[step];
          const current = i === at;
          const done = i < at;
          return (
            <li key={step} className="min-w-0">
              <button
                type="button"
                disabled={i > at && !canOpen(step)}
                aria-current={current ? "step" : undefined}
                onClick={() => onSelect(step)}
                className={cn(
                  "flex min-h-9 w-full items-center justify-center gap-1 rounded-lg border px-1.5 py-1 text-sm font-semibold transition-colors max-sm:min-h-11 sm:gap-1.5 sm:px-2",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default",
                  current ? PILL_ON : done || canOpen(step) ? PILL_OFF : "border-primary/20 text-muted-foreground/50",
                )}
              >
                {/* Phones drop the icons, so every step's name fits its share of the row; the current step keeps its edge. */}
                {done ? (
                  <Check aria-hidden className="size-4 shrink-0 max-sm:hidden" strokeWidth={2.5} />
                ) : (
                  <Icon aria-hidden className="size-4 shrink-0 max-sm:hidden" strokeWidth={2.5} />
                )}
                <span className="truncate">{name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The heading and one line of explanation each phase opens with. In the swipe view the stepper above already names
 * the phase, each card carries its own reasons and ✓ and ✕ say what the gestures do, so the heading and `brief` (a
 * line of what to do) are for screen readers only: on a phone every line above the cards costs card height.
 */
export function PhaseIntro({
  title,
  children,
  brief,
  aside,
}: {
  title: string;
  children: ReactNode;
  brief?: ReactNode;
  /** The buddy's line under the heading, in `font-drama`, where the phase earns one. */
  aside?: string;
}) {
  if (brief !== undefined) {
    return (
      <div className="sr-only">
        <h2>{title}</h2>
        <p>{brief}</p>
      </div>
    );
  }
  return (
    <div>
      <h2 className="font-heading text-2xl leading-none font-semibold tracking-tight">
        {title}
        {aside && <span className="mt-1.5 block font-drama text-xl font-normal tracking-normal italic text-foreground/85">{aside}</span>}
      </h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Where the round stands, beside the round's Undo, Start over and Save (`StepStatusSlot`): the step's count on the
 * right, any control of its own (Combos) after the buttons. The `reason` ("Cut 3 to get back to 100") is read out but
 * not shown: the card on the sheet already says why (owner, 2026-11-21).
 */
export function StepStatus({ reason, count, children }: { reason?: ReactNode; count?: ReactNode; children?: ReactNode }) {
  const slot = useContext(StepStatusSlot);
  if (!slot) return null;
  return createPortal(
    <>
      {children}
      <p role="status" className="ml-auto shrink-0 text-sm text-foreground">
        {reason !== undefined && <span className="sr-only">{reason} </span>}
        {count !== undefined && <span className="font-mono">{count}</span>}
      </p>
    </>,
    slot,
  );
}

/**
 * A bar that stays at the bottom of the screen while a list scrolls, with the step's Next: above the Deck stats footer
 * where that docks (--deck-stats-dock).
 */
export function NextBar({
  label,
  onNext,
  disabled = false,
  children,
}: {
  label: string;
  onNext: () => void;
  disabled?: boolean;
  /** A short status beside the button, e.g. how many cards are marked. */
  children?: ReactNode;
}) {
  return (
    <div className="sticky bottom-[var(--deck-stats-dock,0px)] z-20 -mx-4 flex items-center justify-between gap-3 border-t border-seam bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
      <span className="text-sm text-muted-foreground font-mono">{children}</span>
      <Button type="button" onClick={onNext} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}
