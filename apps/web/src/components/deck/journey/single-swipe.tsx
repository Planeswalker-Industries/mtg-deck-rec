"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { displayName } from "@/lib/cards";
import { DRAW, DrawnCard, SideButton, SWIPE_COOLDOWN_MS, SwipeCard, type AcceptTone, type Direction, type SwipeHandle } from "../swipe-rater";

/**
 * One card at a time, swiped right to accept (cut it, add it) or left to pass. The parent owns the queue: accepting or
 * passing changes its state, and the next card is simply whatever comes first. So there is no index here to drift out of
 * step when the list is recomputed after an accept, as the Add phase's is.
 */
export function SingleSwipe({
  card,
  position,
  total,
  label,
  acceptLabel,
  passLabel,
  caption,
  footer,
  onAccept,
  onPass,
  tone,
}: {
  card: CardSummary;
  /** The job the swipe does, which colours the ✅ button. */
  tone: AcceptTone;
  /** 1-based, for "Card 2 of 5". */
  position: number;
  total: number;
  /** What the sitting is, for the section's accessible name. */
  label: string;
  acceptLabel: string;
  passLabel: string;
  /** Why this card is here: reasons to cut, roles it fills. */
  caption?: ReactNode;
  /** Controls under the card, e.g. "Next: add cards". */
  footer?: ReactNode;
  onAccept: () => void;
  onPass: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const handle = useRef<SwipeHandle>(null);
  const [drag, setDrag] = useState(0);
  const lastSwipeAt = useRef(0);
  const drawing = !reduceMotion && position === 1;

  const canSwipe = () => Date.now() - lastSwipeAt.current >= SWIPE_COOLDOWN_MS;

  const swiped = (direction: Direction) => {
    lastSwipeAt.current = Date.now();
    if (direction === 1) onAccept();
    else onPass();
  };

  const act = (direction: Direction) => {
    if (!canSwipe()) return;
    if (handle.current) handle.current.fling(direction);
    else swiped(direction);
  };

  // Arrow keys do what the buttons do, unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      act(e.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section aria-label={label} className="mx-auto flex w-full max-w-md scroll-mt-44 flex-col">
      <p className="text-sm text-muted-foreground tabular-nums">
        Card {position} of {total}
      </p>
      <div className="mt-2 grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
        <SideButton kind="pass" label={passLabel} pull={Math.max(0, -drag)} disabled={false} onClick={() => act(-1)} />
        {/* Keyed by card: reusing the card that just flew off would leave it off-screen and still marked as leaving. */}
        <SwipeCard key={card.id} ref={handle} onDrag={setDrag} canSwipe={canSwipe} onSwipe={swiped}>
          <DrawnCard play={drawing} delay={0} fromY={DRAW.replacementFromY} className="mx-auto w-[clamp(8rem,calc((100dvh_-_33rem)*0.72),17rem)] max-w-full">
            <ZoomableCard card={card}>
              <CardImage card={card} variant="large" alt={card.name} sizes="272px" eager />
            </ZoomableCard>
          </DrawnCard>
        </SwipeCard>
        <SideButton kind="swap" tone={tone} label={acceptLabel} pull={Math.max(0, drag)} disabled={false} onClick={() => act(1)} />
      </div>
      <div aria-live="polite" className="mt-3 text-center">
        <p className="font-heading text-xl leading-tight font-extrabold">{displayName(card)}</p>
        {caption && <div className="mt-1 text-sm text-muted-foreground">{caption}</div>}
      </div>
      {footer && <div className="mt-3 flex flex-wrap justify-center gap-2">{footer}</div>}
    </section>
  );
}

/** Shown when a swipe sitting has nothing left, with the way on. */
export function SwipeDone({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-6 text-center">
      <p className="text-sm">{message}</p>
      {children}
    </div>
  );
}

