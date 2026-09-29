"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "cn";
import { Band } from "@/components/ui/band";
import { SectionHeading } from "@/components/ui/section-heading";

/** A pointer resting this long on a card turns it over; passing across the grid on the way elsewhere does not. */
const HOVER_FLIP_DELAY_MS = 350;

/**
 * The four places a player starts from, in their own words, and our answer on the back. Answers stay short: two
 * cards share a phone's width.
 */
const SITUATIONS: { said: string; answer: string }[] = [
  {
    said: "I found a great deck online, but I can't afford the singles.",
    answer: "We swap the pricey cards for ones you own that do the same job.",
  },
  {
    said: "I just pulled a legend that should lead a deck.",
    answer: "Paste it as your commander. We fill the 99 from your collection.",
  },
  {
    said: "My pod keeps beating me. What can I swap in tonight?",
    answer: "We find your weakest cards and what you own that beats them.",
  },
  {
    said: "I want a frame to start building from.",
    answer: "Open a popular deck, then cut, add and swap until it's yours.",
  },
];

/**
 * Both faces: the same panel, in the friendly quote font, with the turn-over mark in the corner. Pressable, so it
 * wears the accent like every control: the mark at rest, the edge on hover and keyboard focus.
 */
const FACE = cn(
  "flex flex-col justify-between gap-3 rounded-panel border p-4 text-left backface-hidden [grid-area:1/1]",
  "font-drama text-lg text-balance italic sm:text-xl",
  "transition-colors hover:border-primary/60 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
);

type Situation = (typeof SITUATIONS)[number];

/**
 * One situation as a card that turns over. A mouse resting on it turns it after a moment and turning away turns it
 * back; a click, tap or key press on either face turns it and keeps it turned. Both faces share one grid cell, so the
 * card is as tall as its taller face. The face turned away is `inert`, so neither keyboard nor screen reader lands on
 * it.
 */
function SituationCard({ situation, index }: { situation: Situation; index: number }) {
  const [flipped, setFlipped] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backId = `situation-answer-${index}`;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const turn = (next: boolean) => {
    clearTimer();
    setFlipped(next);
    setPinned(next);
  };

  return (
    <li
      className="perspective-distant"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse" || flipped) return;
        timer.current = setTimeout(() => setFlipped(true), HOVER_FLIP_DELAY_MS);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        clearTimer();
        if (!pinned) setFlipped(false);
      }}
    >
      <div
        className={cn(
          "grid h-full grid-cols-[minmax(0,1fr)] transition-transform duration-450 ease-table transform-3d motion-reduce:transition-none",
          flipped && "rotate-y-180",
        )}
      >
        <button
          type="button"
          aria-expanded={flipped}
          aria-controls={backId}
          inert={flipped}
          onClick={() => turn(true)}
          className={cn(FACE, "border-seam bg-sleeve")}
        >
          <span>&ldquo;{situation.said}&rdquo;</span>
          <RefreshCw aria-hidden className="size-4 self-end text-primary" />
          <span className="sr-only">Show our answer</span>
        </button>

        <button
          type="button"
          id={backId}
          inert={!flipped}
          onClick={() => turn(false)}
          className={cn(FACE, "rotate-y-180 border-primary/40 bg-muted")}
        >
          <span>{situation.answer}</span>
          <RefreshCw aria-hidden className="size-4 self-end text-primary" />
          <span className="sr-only">Back to the question</span>
        </button>
      </div>
    </li>
  );
}

export function Situations() {
  return (
    <Band aria-labelledby="situations" inner="grid grid-cols-[minmax(0,1fr)] gap-6 py-12 md:py-16 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
      <div>
        <SectionHeading id="situations" eyebrow="Who it's for">
          Sound familiar?
        </SectionHeading>
        <p className="mt-4 max-w-prose text-base text-muted-foreground">
          Suggestions come from real decks built around your commander, so a fringe legend gets the same help as The
          Ur-Dragon. If nobody has shared a deck for yours yet, we go and find some.
        </p>
      </div>

      <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        {SITUATIONS.map((situation, i) => (
          <SituationCard key={situation.said} situation={situation} index={i} />
        ))}
      </ul>
    </Band>
  );
}
