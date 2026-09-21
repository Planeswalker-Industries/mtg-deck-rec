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
 * Copy the deck as text, or download it as a text file or a CSV.
 *
 * The copied text is the same decklist the text download holds, built on the server beside the page, so copying
 * needs no request. Downloads go to the export route, which checks visibility the same way the page does.
 */
export function DeckExport({ text, commanderSlug, code }: { text: string; commanderSlug: string; code: string }) {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), COPIED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied permission); the downloads still work.
      setCopy("failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={copyText}>
        {COPY_LABEL[copy]}
      </Button>
      <a href={deckExportHref(commanderSlug, code, "txt")} download className={buttonVariants({ variant: "outline", size: "sm" })}>
        Download text
      </a>
      <a href={deckExportHref(commanderSlug, code, "csv")} download className={buttonVariants({ variant: "outline", size: "sm" })}>
        Download CSV
      </a>
      <span role="status" aria-live="polite" className="sr-only">
        {copy === "copied" ? "Decklist copied to the clipboard" : copy === "failed" ? "Couldn't copy the decklist" : ""}
      </span>
    </div>
  );
}
