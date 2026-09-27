"use client";

import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import type { OpenDeck } from "@/components/deck/use-deck-tool";

const STATUS: Record<OpenDeck["status"], string> = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Couldn't save",
};

/**
 * Which saved deck the tool is editing, and whether the last change reached the account.
 *
 * Editing an open deck writes back on its own, so the only thing left to say is whether it worked. A failure names
 * itself rather than passing quietly, because the player would otherwise keep editing a deck that stopped saving.
 */
export function OpenDeckBar({
  deck,
  onClose,
}: {
  deck: OpenDeck;
  onClose: () => void;
}) {
  return (
    <section aria-label="Saved deck" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0">
        <p className="truncate font-heading text-xl leading-none font-semibold">{deck.name}</p>
        <p
          role={deck.status === "error" ? "alert" : "status"}
          className={deck.status === "error" ? "mt-1 text-sm text-destructive" : "mt-1 text-sm text-muted-foreground"}
        >
          {deck.status === "error" ? (deck.message ?? STATUS.error) : STATUS[deck.status]}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Link
          href={`/decks/deck/${deck.code}` as Route}
          className="rounded-md px-1 py-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Deck page
        </Link>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close deck
        </Button>
      </div>
    </section>
  );
}
