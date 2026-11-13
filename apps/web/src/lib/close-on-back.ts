import { useEffect, useRef } from "react";

/** Marks the history entries open overlays push, with how many overlays deep each one sits. */
const OVERLAY_DEPTH_KEY = "overlayDepth";

/** The overlays Back closes that are open now, bottom first. An overlay's depth is its place here plus one. */
const openOverlays: { close: () => void }[] = [];
let watchingPops = false;

function depthOf(state: unknown): number {
  const depth = state !== null && typeof state === "object" ? (state as Record<string, unknown>)[OVERLAY_DEPTH_KEY] : undefined;
  return typeof depth === "number" ? depth : 0;
}

/**
 * Closes every overlay above the entry Back landed on, topmost first. The pop an overlay makes itself when it closes
 * another way (see `useCloseOnBack`) lands at the depth the stack already has, so it closes nothing.
 */
function onPopState(event: PopStateEvent) {
  const depth = depthOf(event.state);
  while (openOverlays.length > depth) openOverlays.pop()?.close();
}

/**
 * Makes the browser's Back button close an overlay (an enlarged card, a sheet) instead of leaving the page. While
 * `open`, the overlay holds a history entry at the same URL: Next copies its router state onto it, so nothing
 * navigates. Back closes the topmost overlay only; closing it any other way drops its entry again.
 *
 * Only for overlays with no links inside: a link that navigates while closing one would race the `history.back()`.
 */
export function useCloseOnBack(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    if (!watchingPops) {
      window.addEventListener("popstate", onPopState);
      watchingPops = true;
    }
    const overlay = { close: () => close.current() };
    openOverlays.push(overlay);
    const depth = openOverlays.length;
    window.history.pushState({ [OVERLAY_DEPTH_KEY]: depth }, "");
    return () => {
      const index = openOverlays.indexOf(overlay);
      // Back closed it, and its entry is already gone.
      if (index === -1) return;
      openOverlays.splice(index, 1);
      // Closed some other way (a tap, Escape, the view moving on): drop its entry while it is still the current one.
      if (depthOf(window.history.state) === depth) window.history.back();
    };
  }, [open]);
}
