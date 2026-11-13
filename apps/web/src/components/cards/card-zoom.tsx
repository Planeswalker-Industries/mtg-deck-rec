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

/** Marks the history entry a pressed-open card pushes, so the phone's Back button closes the card, not the page. */
const ZOOM_HISTORY_KEY = "cardZoom";

/**
 * How many `history.back()` calls closing a card has made whose popstate hasn't arrived yet. Those popstates undo the
 * card's own entry and must not close the next card (React's dev Strict Mode mounts a layer twice, back to back).
 */
let pendingZoomBacks = 0;
/** Whether the popstate being handled is one of those, set before any layer's own listener runs. */
let popIsZoomCleanup = false;
let zoomPopWatcherInstalled = false;

/** One capture listener for the whole page, so a cleanup's popstate is counted even when no card is open by then. */
function watchZoomPops() {
  if (zoomPopWatcherInstalled) return;
  zoomPopWatcherInstalled = true;
  window.addEventListener(
    "popstate",
    () => {
      popIsZoomCleanup = pendingZoomBacks > 0;
      if (popIsZoomCleanup) pendingZoomBacks -= 1;
    },
    true,
  );
}

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
  hover = true,
}: {
  card: CardSummary;
  children: ReactNode;
  className?: string;
  trigger?: "tap" | "icon";
  /** Which face to enlarge, for a double-faced card shown on its back. */
  face?: "front" | "back";
  /**
   * Whether a resting mouse opens it. Off inside a scrolling panel (the deckbuilder's search results): the layer
   * locks page scroll, the scrollbar under the pointer vanishes, and the pointer never "leaves", so the card stayed up
   * until Escape. A click or tap still opens it.
   */
  hover?: boolean;
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
      if (!hover || e.pointerType !== "mouse" || open || e.buttons !== 0) return;
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
          className={cn(
            // A pressable card: blue focus ring and a slight lift under a mouse, never blue on the card itself.
            "cursor-zoom-in transition-transform duration-180 ease-table [@media(hover:hover)]:hover:-translate-y-0.5",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            className,
          )}
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
              "absolute top-2 left-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/70 text-primary",
              // A 44 px touch target around the 32 px dot, so the dot stays small over the card name.
              "after:absolute after:-inset-1.5 after:content-['']",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/zoom:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
            )}
          >
            <ZoomIn aria-hidden className="size-4" />
          </button>
        </div>
      )}

      {open && <CardZoomLayer card={card} face={face} passThrough={openBy === "hover"} onClose={(byPointer) => setOpen(null, byPointer)} />}
    </>
  );
}

/**
 * The enlarged card on its dimmed layer, put in the body. A press on the layer closes it; the press is swallowed so it
 * never reaches the card underneath. `footer` takes the Close button's place (a tap anywhere else closes), and presses
 * inside it stay there. `passThrough` is the hover-opened copy, which lets the pointer through.
 */
export function CardZoomLayer({
  card,
  face = "front",
  passThrough = false,
  footer,
  onClose,
}: {
  card: CardSummary;
  face?: "front" | "back";
  passThrough?: boolean;
  footer?: ReactNode;
  /** `byPointer`: closed by a press, whose leftover click must not reopen the card. */
  onClose: (byPointer: boolean) => void;
}) {
  const name = displayName(card);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    // Capture, so the swipe view's arrow keys never fire while the enlarged card is up, and Escape closes the card
    // rather than the sheet it was opened over.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close.current(false);
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
  }, []);
  useEffect(() => {
    // A hover-opened copy follows the mouse; only a pressed-open card is something Back should close.
    if (passThrough) return;
    // Same URL, so Next's router keeps its own state on the entry (it copies it over) and nothing navigates.
    watchZoomPops();
    window.history.pushState({ [ZOOM_HISTORY_KEY]: true }, "");
    let poppedByBack = false;
    function onPopState() {
      if (popIsZoomCleanup) return;
      poppedByBack = true;
      close.current(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Closed some other way (a tap, Escape, the view moving on): drop the entry this card pushed.
      if (!poppedByBack && window.history.state?.[ZOOM_HISTORY_KEY] === true) {
        pendingZoomBacks += 1;
        window.history.back();
      }
    };
  }, [passThrough]);
  const dismiss = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    close.current(true);
  };
  // Into the body: the swipe view animates cards with transforms, and a transformed ancestor would make this "fixed"
  // layer cover only the card itself, letting a dismissing press through to whatever sits below.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${name}, enlarged`}
      {...{ [ZOOM_LAYER_ATTRIBUTE]: "" }}
      // Closing waits for the click: unmounting on pointerdown would hand the click that follows to whatever the
      // layer was covering. The pointer events are swallowed so the card below never starts a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={dismiss}
      className={cn(
        "fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-black/85",
        // Without a footer nothing in the layer scrolls, and a touch must not pan the page.
        footer === undefined && "touch-none",
        // A Radix modal turns pointer events off on the body; a pressed-open card has to take them back.
        passThrough ? "pointer-events-none" : "pointer-events-auto",
      )}
    >
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-4">
        <div className="max-h-[78dvh] w-[min(90vw,24rem)] [&_img]:mx-auto [&_img]:max-h-[78dvh] [&_img]:w-auto">
          <CardImage card={card} face={face} variant="large" alt={`${name}, enlarged`} sizes="(max-width: 480px) 90vw, 384px" eager />
        </div>
        {footer !== undefined ? (
          <div className="w-[min(90vw,24rem)]" onClick={(e) => e.stopPropagation()}>
            {footer}
          </div>
        ) : (
          !passThrough && (
            <button
              type="button"
              onClick={dismiss}
              className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <X aria-hidden className="size-4" />
              Close
            </button>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}
