"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { displayName } from "@/lib/cards";

/** How long a mouse has to rest on a card before it opens by itself. */
const HOVER_DELAY_MS = 450;
/** A press held longer than this is someone holding the card (deciding which way to swipe), not a tap to enlarge it. */
const TAP_MAX_MS = 350;

/** How long after a dismissal a click is taken as the dismissing press's leftover, not a new request to open. */
const DISMISS_CLICK_GRACE_MS = 400;

/** When an enlarged card was last dismissed: the click a dismissing tap leaves behind must not open it again. */
let dismissedAt = 0;

/**
 * Marks the enlarged-card layer, so a modal it opens over (the replacement sheet) can tell a press on it from a press
 * outside the modal, which would close the modal. See `isCardZoomEvent`.
 */
const ZOOM_LAYER_ATTRIBUTE = "data-card-zoom";

/** For a Radix modal's `onInteractOutside`: true when the press landed on an enlarged card, which must not close it. */
export function isCardZoomEvent(event: { target: EventTarget | null }): boolean {
  return event.target instanceof Element && event.target.closest(`[${ZOOM_LAYER_ATTRIBUTE}]`) !== null;
}

/**
 * Wraps a card so it can be seen bigger. A mouse resting on it opens after a moment either way; `trigger` decides what
 * a press does:
 *
 * - `"tap"` (default): a click or tap on the card opens it at once. For cards that do nothing else when pressed, like
 *   the ones in the swipe view and the replacement sheet.
 * - `"icon"`: the card keeps its own press (opening the replacement sheet, picking an option), and a magnifier button
 *   in its top-left corner opens it instead. Put it around the whole pressable pocket, not inside it: the magnifier is a
 *   button of its own and can't sit inside another.
 *
 * The enlarged card fills a dimmed layer over everything, so the press that dismisses it can't reach the card
 * underneath and swipe it by accident. Arrow keys and Escape are swallowed while it's up, for the same reason.
 */
export function ZoomableCard({
  card,
  children,
  className,
  trigger = "tap",
  face = "front",
}: {
  card: CardSummary;
  children: ReactNode;
  className?: string;
  trigger?: "tap" | "icon";
  /** Which face to enlarge, for a double-faced card shown on its back. */
  face?: "front" | "back";
}) {
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
    // Capture, so the swipe view's arrow keys never fire while the enlarged card is up, and Escape closes the card
    // rather than the sheet it was opened over.
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

  const hoverHandlers = {
    onPointerDown: () => {
      // A card being held, as when it is dragged in the swipe view or pressed to open the replacement sheet, never
      // opens: the hover timer would otherwise run out mid-press and dim the view. A hover-opened copy closes too.
      pressedAt.current = Date.now();
      clearTimer();
      if (openBy === "hover") setOpen(null);
    },
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || open || e.buttons !== 0) return;
      clearTimer();
      timer.current = window.setTimeout(() => setOpen("hover"), HOVER_DELAY_MS);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      clearTimer();
      if (openBy === "hover") setOpen(null);
    },
  };

  return (
    <>
      {trigger === "tap" ? (
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
          {...hoverHandlers}
          onClick={() => {
            clearTimer();
            const heldFor = pressedAt.current === null ? 0 : Date.now() - pressedAt.current;
            pressedAt.current = null;
            if (Date.now() - dismissedAt < DISMISS_CLICK_GRACE_MS || heldFor > TAP_MAX_MS) return;
            setOpen("press");
          }}
        >
          {children}
        </div>
      ) : (
        <div className={cn("group/zoom relative", className)} {...hoverHandlers}>
          {children}
          {/*
            Top left, over the card name (every pocket repeats the name under the image), not top right, where the mana
            cost is shown nowhere else. Never the bottom: Scryfall asks for the artist and copyright line to stay
            visible. Always shown where there is no hover (touch); a mouse reveals it on hover, and keyboard focus too.
          */}
          <button
            type="button"
            aria-label={`Enlarge ${name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              clearTimer();
              setOpen("press");
            }}
            className={cn(
              "absolute top-2 left-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/65 text-white",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/zoom:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
            )}
          >
            <ZoomIn aria-hidden className="size-4" />
          </button>
        </div>
      )}

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
            {...{ [ZOOM_LAYER_ATTRIBUTE]: "" }}
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
              // A Radix modal turns pointer events off on the body; a pressed-open card has to take them back.
              openBy === "hover" ? "pointer-events-none" : "pointer-events-auto",
            )}
          >
            <div className="max-h-[78dvh] w-[min(90vw,24rem)] [&_img]:mx-auto [&_img]:max-h-[78dvh] [&_img]:w-auto">
              <CardImage card={card} face={face} variant="large" alt={`${name}, enlarged`} sizes="(max-width: 480px) 90vw, 384px" eager />
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
