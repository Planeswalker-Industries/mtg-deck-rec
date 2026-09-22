"use client";

import type { ReactNode } from "react";
import { Check, ClipboardList, Plus, Repeat2, Scissors } from "lucide-react";
import { JOURNEY_PHASES, type JourneyPhase } from "@mtg/core/journey";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

/** Each step is lit in its job's colour: the icon, and a line of light along the bottom of the current step. */
const STEPS: Record<JourneyPhase, { name: string; Icon: typeof Scissors; tone: string; glow: string }> = {
  cut: { name: "Cut", Icon: Scissors, tone: "text-cut", glow: "shadow-[inset_0_-2px_0_var(--cut)]" },
  add: { name: "Add", Icon: Plus, tone: "text-add", glow: "shadow-[inset_0_-2px_0_var(--add)]" },
  replace: { name: "Replace", Icon: Repeat2, tone: "text-replace", glow: "shadow-[inset_0_-2px_0_var(--replace)]" },
  review: { name: "Review", Icon: ClipboardList, tone: "text-primary", glow: "shadow-[inset_0_-2px_0_var(--primary)]" },
};

/**
 * Where the player is in the journey. Earlier steps can be revisited; later ones open through each step's own Next,
 * because each asks for its suggestions against the choices made before it.
 */
export function JourneyStepper({ phase, onSelect }: { phase: JourneyPhase; onSelect: (phase: JourneyPhase) => void }) {
  const at = JOURNEY_PHASES.indexOf(phase);
  return (
    <nav aria-label="Deck upgrade steps">
      <ol className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-0.5">
        {JOURNEY_PHASES.map((step, i) => {
          const { name, Icon, tone, glow } = STEPS[step];
          const current = i === at;
          const done = i < at;
          return (
            <li key={step} className="min-w-0">
              <button
                type="button"
                disabled={i > at}
                aria-current={current ? "step" : undefined}
                onClick={() => onSelect(step)}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-bold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default",
                  current ? cn("bg-sleeve text-foreground", glow) : done ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50",
                )}
              >
                {done ? <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.5} /> : <Icon aria-hidden className={cn("size-4 shrink-0", current && tone)} strokeWidth={2.5} />}
                <span className="truncate">{name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The heading and one line of explanation each phase opens with. */
export function PhaseIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="font-heading text-3xl leading-none font-extrabold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** A bar that stays at the bottom of the screen while a list scrolls, with the step's Next. */
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
    <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-between gap-3 border-t border-seam bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
      <span className="text-sm text-muted-foreground tabular-nums">{children}</span>
      <Button type="button" onClick={onNext} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}
