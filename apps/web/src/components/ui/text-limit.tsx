"use client";

import { useState, type ClipboardEvent } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";

/** The count under a box shows from 90% of its limit: early enough to see it coming, late enough not to nag. */
const TEXT_COUNT_FROM_FRACTION = 0.9;

/** The one line for text over a box's limit, also used when a file's text is too long for the box. */
export function charLimitError(maxChars: number, next = "Try again."): string {
  return `Character limit (${maxChars.toLocaleString("en-US")}) exceeded. ${next}`;
}

/**
 * Refuses a paste that would take a text box past `maxChars`, whole: the box keeps what it had and the error says
 * why. `maxLength` alone would cut the paste silently, and a cut decklist or collection looks like it worked.
 */
export function useTextLimit(
  maxChars: number,
  next = "Try again.",
): {
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  error: string | null;
  clearError: () => void;
} {
  const [error, setError] = useState<string | null>(null);

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const box = e.currentTarget;
    const pasted = e.clipboardData.getData("text").length;
    // A paste replaces the selection, so a paste over selected text that fits is allowed.
    const replaced = box.selectionEnd - box.selectionStart;
    if (box.value.length - replaced + pasted > maxChars) {
      e.preventDefault();
      setError(charLimitError(maxChars, next));
    } else {
      setError(null);
    }
  }

  return { onPaste, error, clearError: () => setError(null) };
}

/** `18,200 / 20,000` under a box once its text nears the limit; nothing before that. */
export function TextLimitCount({ length, max, className }: { length: number; max: number; className?: string }) {
  if (length < max * TEXT_COUNT_FROM_FRACTION) return null;
  const atLimit = length >= max;
  return (
    <p
      aria-live={atLimit ? "polite" : undefined}
      className={cn(
        "flex items-center justify-end gap-1 font-mono text-xs",
        atLimit ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {atLimit && <CircleAlert aria-hidden className="size-3.5 shrink-0" />}
      {length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </p>
  );
}
