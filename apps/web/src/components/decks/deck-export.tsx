"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ClipboardCopy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deckExportHref } from "@/lib/deck-export";

/** How long "Copied" stays on the button before it reads "Copy decklist" again. */
const COPIED_NOTICE_MS = 2000;

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy decklist",
  copied: "Copied",
  failed: "Copy failed",
};

/** The short labels beside the clipboard icon, where the button sits among others. */
const SHORT_COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy",
  copied: "Copied",
  failed: "Failed",
};

/**
 * Copies a decklist to the clipboard, saying "Copied" (or "Copy failed") for a moment. Shared by a saved deck's export
 * and the deck tool's Done step.
 */
export function CopyDecklistButton({
  text,
  size = "sm",
  disabled = false,
  short = false,
}: {
  /** The decklist, or a function that builds it at the moment of copying. */
  text: string | (() => string | null);
  size?: "sm" | "lg";
  disabled?: boolean;
  /** A clipboard icon and "Copy", for a row of buttons. */
  short?: boolean;
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
      <Button variant="outline" size={size} onClick={copyText} disabled={disabled} {...(short ? { "aria-label": "Copy decklist" } : {})}>
        {short && <ClipboardCopy aria-hidden />}
        {(short ? SHORT_COPY_LABEL : COPY_LABEL)[copy]}
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
      <CopyDecklistButton text={text} short />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Download aria-hidden />
            Download
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild className="text-primary focus:text-primary">
            <a href={deckExportHref(commanderSlug, code, "txt")} download>
              Text (.txt)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="text-primary focus:text-primary">
            <a href={deckExportHref(commanderSlug, code, "csv")} download>
              CSV (.csv)
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
