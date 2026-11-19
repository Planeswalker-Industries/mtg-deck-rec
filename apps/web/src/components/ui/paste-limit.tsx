"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { charLimitError } from "./text-limit";

/** How long the bubble stays up: long enough to read one short line. */
const BUBBLE_SHOW_MS = 4000;
/** Space between the field and the bubble under it. */
const BUBBLE_GAP_PX = 6;
/** The page's side gutter on phones: the bubble never runs past it. */
const VIEWPORT_GUTTER_PX = 16;
/** A field marked with this keeps the browser's own cut of a long paste (the sign-in code strips what it doesn't need). */
const PASTE_TRUNCATE_ATTR = "data-paste-truncate";

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Bubble {
  message: string;
  top: number;
  left: number;
  maxWidth: number;
}

/** How long a paste would make the field: a line break is one character in a box and none in a one-line field. */
function lengthAfterPaste(field: Field, pasted: string): number {
  const text = field instanceof HTMLTextAreaElement ? pasted.replace(/\r\n?/g, "\n") : pasted.replace(/[\r\n]/g, "");
  // Email and number fields have no selection to read; a paste there adds to what is in it.
  let replaced = 0;
  try {
    replaced = (field.selectionEnd ?? 0) - (field.selectionStart ?? 0);
  } catch {
    replaced = 0;
  }
  return field.value.length - replaced + text.length;
}

/**
 * Refuses a paste that would take any field past its `maxLength`, whole, and says so in a small amber bubble under
 * the field. `maxLength` alone cuts the paste without a word. Mounted once in the root layout; a field whose own paste
 * guard already refused the paste (the deck and collection boxes) is left to it.
 */
export function PasteLimitBubble() {
  const [bubble, setBubble] = useState<Bubble | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shownFor: Field | null = null;
    const hide = () => {
      clearTimeout(timer);
      shownFor?.removeEventListener("input", hide);
      shownFor?.removeEventListener("blur", hide);
      shownFor = null;
      setBubble(null);
    };
    function onPaste(e: ClipboardEvent) {
      const field = e.target;
      if (e.defaultPrevented || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
      if (field.maxLength < 0 || field.hasAttribute(PASTE_TRUNCATE_ATTR)) return;
      const pasted = e.clipboardData?.getData("text") ?? "";
      if (lengthAfterPaste(field, pasted) <= field.maxLength) return;
      e.preventDefault();
      hide();
      const box = field.getBoundingClientRect();
      const left = Math.max(VIEWPORT_GUTTER_PX, box.left);
      setBubble({
        message: charLimitError(field.maxLength, null),
        top: box.bottom + BUBBLE_GAP_PX,
        left,
        maxWidth: window.innerWidth - left - VIEWPORT_GUTTER_PX,
      });
      shownFor = field;
      field.addEventListener("input", hide);
      field.addEventListener("blur", hide);
      timer = setTimeout(hide, BUBBLE_SHOW_MS);
    }
    document.addEventListener("paste", onPaste);
    // A fixed bubble would drift off its field as the page moves.
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!bubble) return null;
  return (
    <p
      role="alert"
      style={{ top: bubble.top, left: bubble.left, maxWidth: bubble.maxWidth }}
      className="pointer-events-none fixed z-[60] flex items-center gap-1.5 rounded-md border border-warning/40 bg-popover px-2.5 py-1.5 text-sm text-foreground shadow-lg"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
      {bubble.message}
    </p>
  );
}
