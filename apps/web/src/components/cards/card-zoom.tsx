"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { displayName } from "@/lib/cards";

/** How long a mouse has to rest on a card before it opens by itself. */
const HOVER_DELAY_MS = 450;
/** A press held longer than this is someone holding the card (deciding which way to swipe), not a tap to enlarge it. */
const TAP_MAX_MS = 350;

/** When an enlarged card was last dismissed: the click a dismissing tap leaves behind must not open it again. */
let dismissedAt = 0;

/**
 * Wraps a card so it can be seen bigger: a mouse resting on it opens after a moment, a click or a tap opens it at once.
 * The enlarged card fills a dimmed layer over everything, so the press that dismisses it can't reach the card
 * underneath and swipe it by accident. Arrow keys are swallowed while it's up, for the same reason.
 */
export function ZoomableCard({ card, children, className }: { card: CardSummary; children: ReactNode; className?: string }) {
  /**
   * How it was opened decides how it closes. A hovered card follows the mouse away, so its enlarged copy lets the
   * pointer through: covering the card would fire pointerleave and shut it again at once. A clicked or tapped one is
   * solid and closes on the next press, which is what keeps that press off the card underneath.
   */
  const [openBy, setOpenBy] = useState<"hover" | "press" | null>(null);
  const open = openBy !== null;
  const timer = useRef<number | null>(null);
  /** When the current press started, or null when no button or finger is down. */
  const pressedAt = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }

  /** `byPointer`: the press that closed it leaves a click behind, which must not reopen the card. */
  function setOpen(next: "hover" | "press" | null, byPointer = false) {
    if (next === null && byPointer) dismissedAt = Date.now();
    setOpenBy(next);
  }

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) return;
    // Capture, so the swipe view's arrow keys never fire while the enlarged card is up.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
      else if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.stopPropagation();
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const name = displayName(card);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Enlarge ${name}`}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          setOpen("press");
        }}
        className={cn("cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", className)}
        onPointerDown={() => {
          // A card being held, as when it is dragged in the swipe view, never opens: the hover timer would otherwise
          // run out mid-drag and dim the view over the card in hand. A hover-opened copy closes for the same reason.
          pressedAt.current = Date.now();
          clearTimer();
          if (openBy === "hover") setOpen(null);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse" || open || e.buttons !== 0) return;
          clearTimer();
          timer.current = window.setTimeout(() => setOpen("hover"), HOVER_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          clearTimer();
          if (openBy === "hover") setOpen(null);
        }}
        onClick={() => {
          clearTimer();
          const heldFor = pressedAt.current === null ? 0 : Date.now() - pressedAt.current;
          pressedAt.current = null;
          if (Date.now() - dismissedAt < 400 || heldFor > TAP_MAX_MS) return;
          setOpen("press");
        }}
      >
        {children}
      </div>

      {/*
        Into the body: the swipe view animates cards with transforms, and a transformed ancestor would make this
        "fixed" layer cover only the card itself, letting a dismissing press through to whatever sits below.
      */}
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${name}, enlarged`}
            // Closing waits for the click: unmounting on pointerdown would hand the click that follows to whatever the
            // layer was covering. The pointer events are swallowed so the card below never starts a drag.
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(null, true);
            }}
            className={cn(
              "fixed inset-0 z-[70] flex touch-none flex-col items-center justify-center gap-3 bg-black/85 p-4",
              openBy === "hover" && "pointer-events-none",
            )}
          >
            <div className="max-h-[78dvh] w-[min(90vw,24rem)] [&_img]:mx-auto [&_img]:max-h-[78dvh] [&_img]:w-auto">
              <CardImage card={card} variant="large" alt={`${name}, enlarged`} sizes="(max-width: 480px) 90vw, 384px" eager />
            </div>
            {openBy === "press" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(null, true);
                }}
                className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <X aria-hidden className="size-4" />
                Close
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
