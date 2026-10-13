"use client";

import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { deckExportHref } from "@/lib/deck-export";

/** How long "Copied" stays on the button before it reads "Copy decklist" again. */
const COPIED_NOTICE_MS = 2000;

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy decklist",
  copied: "Copied",
  failed: "Copy failed",
};

/**
 * Copies a decklist to the clipboard, saying "Copied" (or "Copy failed") for a moment. Shared by a saved deck's export
 * and the deck tool's Done step.
 */
export function CopyDecklistButton({
  text,
  size = "sm",
  disabled = false,
}: {
  /** The decklist, or a function that builds it at the moment of copying. */
  text: string | (() => string | null);
  size?: "sm" | "lg";
  disabled?: boolean;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), COPIED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  const copyText = async () => {
    const value = typeof text === "function" ? text() : text;
    if (value === null) return setCopy("failed");
    try {
      await navigator.clipboard.writeText(value);
      setCopy("copied");
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied permission); the downloads still work.
      setCopy("failed");
    }
  };

  return (
    <>
      <Button variant="outline" size={size} onClick={copyText} disabled={disabled}>
        {COPY_LABEL[copy]}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copy === "copied" ? "Decklist copied to the clipboard" : copy === "failed" ? "Couldn't copy the decklist" : ""}
      </span>
    </>
  );
}

/**
 * Copy the deck as text, or download it as a text file or a CSV.
 *
 * The copied text is the same decklist the text download holds, built on the server beside the page, so copying
 * needs no request. Downloads go to the export route, which checks visibility the same way the page does.
 */
export function DeckExport({ text, commanderSlug, code }: { text: string; commanderSlug: string; code: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyDecklistButton text={text} />
      <a href={deckExportHref(commanderSlug, code, "txt")} download className={buttonVariants({ variant: "outline", size: "sm" })}>
        Download text
      </a>
      <a href={deckExportHref(commanderSlug, code, "csv")} download className={buttonVariants({ variant: "outline", size: "sm" })}>
        Download CSV
      </a>
    </div>
  );
}
