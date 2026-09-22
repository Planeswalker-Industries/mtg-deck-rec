"use client";

import { useState } from "react";
import Link from "next/link";
import type { Bracket, DeckAnalysis, DeckId } from "@mtg/core/contract";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";

/**
 * Saves the analysed deck to the signed-in user's account. Saving is deliberately explicit: a new deck is public,
 * so a throwaway paste must never become a page on its own.
 *
 * Once it has been saved the tool goes on editing that deck, so this hands the deck over through `onSaved` and has
 * nothing more to say.
 */
export function SaveDeckButton({
  analysis,
  bracket,
  onSaved,
  defaultOpen = false,
}: {
  analysis: DeckAnalysis;
  /** The bracket on screen, stored with the deck so reopening it comes back the same. */
  bracket: Bracket | null;
  onSaved: (deck: { deckId: DeckId; code: string; name: string }) => void;
  /** Opens on the name form, for when the player has already asked to save (the journey's Review). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(() => suggestedName(analysis));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);

  if (needsAccount) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href="/sign-in?next=/deck" className="font-medium text-primary underline underline-offset-2">
          Sign in
        </Link>{" "}
        to save decks to your account.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Save deck
      </Button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed || busy) return;
        setBusy(true);
        setError(null);
        void getApis()
          .actions.saveDeck({
            name: trimmed,
            deck: analysis.deck,
            isPublic: true,
            ...(bracket === null ? {} : { bracket }),
          })
          .then((result) => {
            setBusy(false);
            if (result.ok) onSaved({ ...result.data, name: trimmed });
            else if (result.error.code === "UNAUTHENTICATED") setNeedsAccount(true);
            else setError(result.error.message);
          });
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-label="Deck name"
        maxLength={MAX_DECK_NAME_CHARS}
        className="h-9 w-56 bg-sleeve"
      />
      <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
        {busy ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="w-full text-right text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** Prefilled from the commander, so saving is one click for anyone who doesn't care about the name. */
function suggestedName(analysis: DeckAnalysis): string {
  const names = analysis.commanderKey.commanders.map(displayName);
  return names.length === 0 ? "My Commander deck" : names.join(" and ").slice(0, MAX_DECK_NAME_CHARS);
}
