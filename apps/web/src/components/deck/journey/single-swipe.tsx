"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { CardPanel, DecisionButtons, type DecisionTone } from "@/components/cards/card-panel";
import { usePreloadCardImages } from "@/components/cards/dealt-card";
import { useBrowseSwipe } from "@/components/cards/use-browse-swipe";
import { useCardRules } from "@/lib/card-rules";
import { CARD_IMAGES_AHEAD } from "@/lib/constants";
import { StatChips } from "../deck-stats/stat-chips";
import { useStatPreview } from "../deck-stats/stat-preview";
import { SWIPE_COOLDOWN_MS } from "../swipe-rater";

/**
 * One card at a time, in full (image beside its rules text), answered with the two buttons under it. Swiping the card
 * (or the arrow keys) browses without deciding: left shows the next card, right the previous. The parent owns the list
 * and the cursor into it, and clamps the cursor when an accept shortens the list.
 *
 * `upcoming` names the next few cards, whose rules are fetched now so they are in hand when they are dealt; the first
 * `CARD_IMAGES_AHEAD` have their images fetched too, so they are dealt face up.
 */
export function SingleSwipe({
  card,
  upcoming = [],
  previewAs,
  counter,
  label,
  acceptLabel,
  passLabel,
  acceptWord,
  passWord,
  caption,
  owned = false,
  footer,
  onAccept,
  onPass,
  onNext,
  onPrevious,
  canNext,
  canPrevious,
  tourTarget,
  tone,
  acceptIcon,
  passIcon,
}: {
  card: CardSummary;
  upcoming?: readonly CardSummary[];
  /** What accepting does to the deck, for Deck stats' preview: puts the card in, or takes it out. */
  previewAs: "add" | "remove";
  /** The job the swipe does, which colours the accept button. */
  tone: DecisionTone;
  /** The browsed place, 1-based, for "Card 2 of 5". Absent where the step has no set end to count toward (Add). */
  counter?: { position: number; total: number };
  /** What the sitting is, for the section's accessible name. */
  label: string;
  /** The buttons' accessible names, naming the card ("Cut Sol Ring"), and their visible words ("Cut"). */
  acceptLabel: string;
  passLabel: string;
  acceptWord: string;
  passWord: string;
  /** Why this card is here: reasons to cut, roles it fills, play rate, price. */
  caption?: ReactNode;
  /** Marks the card as owned, in its image's corner. */
  owned?: boolean;
  /** Controls under the buttons, e.g. "Done adding". */
  footer?: ReactNode;
  onAccept: () => void;
  onPass: () => void;
  /** Browse: show the next card in the list, or the previous one. Neither decides anything. */
  onNext: () => void;
  onPrevious: () => void;
  /** False at the list's end (or start): a swipe that way springs back. */
  canNext: boolean;
  canPrevious: boolean;
  /** The card's `data-tour` id, for the tours. */
  tourTarget?: string;
  acceptIcon?: LucideIcon;
  passIcon?: LucideIcon;
}) {
  const lastAt = useRef(0);
  const rulesFor = useCardRules([card.id, ...upcoming.map((c) => c.id)]);
  usePreloadCardImages(upcoming.slice(0, CARD_IMAGES_AHEAD));
  useStatPreview(previewAs === "add" ? card : null, previewAs === "remove" ? card : null);

  const browse = useBrowseSwipe({ onNext, onPrevious, canNext, canPrevious, tourTarget });

  // A double tap would otherwise answer the card that just came up, which the player never saw.
  const act = (accept: boolean) => {
    if (Date.now() - lastAt.current < SWIPE_COOLDOWN_MS) return;
    lastAt.current = Date.now();
    if (accept) onAccept();
    else onPass();
  };

  // Arrow keys browse as the swipe does (right is the next card), unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      if (e.key === "ArrowRight") {
        if (canNext) onNext();
      } else if (canPrevious) onPrevious();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section aria-label={label} className="mx-auto flex w-full max-w-2xl scroll-mt-44 flex-col gap-3">
      {counter && (
        <p className="text-sm text-muted-foreground font-mono">
          {/* "1 of 14": the word "Card" is read out, not shown (owner, 2026-11-18). */}
          <span className="sr-only">Card </span>
          {counter.position} of {counter.total}
        </p>
      )}
      <div aria-live="polite" data-tour={tourTarget} {...browse.bind}>
        <CardPanel card={card} rules={rulesFor(card.id)} owned={owned}>
          {caption}
        </CardPanel>
      </div>
      {/* The Deck stats lines this card moves, under it across the mat: the footer only says what it does to the score. */}
      <StatChips add={previewAs === "add" ? card : null} remove={previewAs === "remove" ? card : null} />
      <DecisionButtons
        tone={tone}
        pass={{ word: passWord, label: passLabel, icon: passIcon, onClick: () => act(false) }}
        accept={{ word: acceptWord, label: acceptLabel, icon: acceptIcon, onClick: () => act(true) }}
      />
      {footer && <div className="-mt-1 flex flex-wrap justify-center gap-2">{footer}</div>}
    </section>
  );
}

/**
 * Shown when a step has nothing (left) to deal, with the way on. A panel with a heading rather than a quiet line, so an
 * empty step reads as finished, not as still loading.
 */
export function SwipeDone({ title, message, children }: { title?: ReactNode; message: string; children?: ReactNode }) {
  return (
    <div role="status" className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-5 py-8 text-center">
      {title && <p className="font-heading text-xl leading-tight font-semibold text-balance">{title}</p>}
      <p className="max-w-prose text-sm text-muted-foreground text-pretty">{message}</p>
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

