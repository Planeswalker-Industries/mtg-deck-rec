"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { CardId, CardSummary } from "@mtg/core/contract";
import { CardPanel, DecisionButtons, type DecisionTone } from "@/components/cards/card-panel";
import { useCardRules } from "@/lib/card-rules";
import { useStatPreview } from "../deck-stats/stat-preview";
import { SWIPE_COOLDOWN_MS } from "../swipe-rater";

/**
 * One card at a time, in full (image beside its rules text), answered with the two buttons under it or the arrow keys:
 * right accepts (cut it, add it), left passes. The parent owns the queue: accepting or passing changes its state, and
 * the next card is simply whatever comes first. So there is no index here to drift out of step when the list is
 * recomputed after an accept, as the Add step's is.
 *
 * `upcoming` names the next few cards, whose rules are fetched now so they are in hand when they are dealt.
 */
export function SingleSwipe({
  card,
  upcoming = [],
  previewAs,
  position,
  total,
  label,
  acceptLabel,
  passLabel,
  acceptWord,
  passWord,
  caption,
  footer,
  onAccept,
  onPass,
  tone,
  acceptIcon,
  passIcon,
}: {
  card: CardSummary;
  upcoming?: readonly CardId[];
  /** What accepting does to the deck, for Deck stats' preview: puts the card in, or takes it out. */
  previewAs: "add" | "remove";
  /** The job the swipe does, which colours the accept button. */
  tone: DecisionTone;
  /** 1-based, for "Card 2 of 5". */
  position: number;
  total: number;
  /** What the sitting is, for the section's accessible name. */
  label: string;
  /** The buttons' accessible names, naming the card ("Cut Sol Ring"), and their visible words ("Cut"). */
  acceptLabel: string;
  passLabel: string;
  acceptWord: string;
  passWord: string;
  /** Why this card is here: reasons to cut, roles it fills, play rate, price. */
  caption?: ReactNode;
  /** Controls under the buttons, e.g. "Done adding". */
  footer?: ReactNode;
  onAccept: () => void;
  onPass: () => void;
  acceptIcon?: LucideIcon;
  passIcon?: LucideIcon;
}) {
  const lastAt = useRef(0);
  const rulesFor = useCardRules([card.id, ...upcoming]);
  useStatPreview(previewAs === "add" ? card : null, previewAs === "remove" ? card : null);

  // A double tap would otherwise answer the card that just came up, which the player never saw.
  const act = (accept: boolean) => {
    if (Date.now() - lastAt.current < SWIPE_COOLDOWN_MS) return;
    lastAt.current = Date.now();
    if (accept) onAccept();
    else onPass();
  };

  // Arrow keys do what the buttons do, unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      act(e.key === "ArrowRight");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <section aria-label={label} className="playmat mx-auto flex w-full max-w-2xl scroll-mt-44 flex-col gap-3">
      <p className="text-sm text-muted-foreground font-mono">
        Card {position} of {total}
      </p>
      <div aria-live="polite">
        <CardPanel card={card} rules={rulesFor(card.id)}>
          {caption}
        </CardPanel>
      </div>
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
export function SwipeDone({ title, message, children }: { title?: string; message: string; children?: ReactNode }) {
  return (
    <div role="status" className="playmat mx-auto flex w-full max-w-md flex-col items-center gap-3 px-5 py-8 text-center">
      {title && <p className="font-heading text-xl leading-tight font-semibold text-balance">{title}</p>}
      <p className="max-w-prose text-sm text-muted-foreground text-pretty">{message}</p>
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

