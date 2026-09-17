"use client";

import { useState, useTransition } from "react";
import type { DeckId } from "@mtg/core/contract";
import { Switch } from "@/components/ui/switch";
import { getApis } from "@/lib/api/client";

/**
 * Shows or hides the deck's page.
 *
 * The wording is load-bearing: hiding a deck does **not** take it out of the play-rate aggregates, and the control
 * has to say so rather than let "private" imply more than it delivers.
 */
export function DeckVisibility({ deckId, isPublic }: { deckId: DeckId; isPublic: boolean }) {
  const [on, setOn] = useState(isPublic);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-seam bg-sleeve/60 p-4">
      <div className="flex items-start gap-3">
        <Switch
          id="deck-public"
          checked={on}
          disabled={pending}
          onCheckedChange={(next) => {
            const previous = on;
            setOn(next);
            setError(null);
            startTransition(async () => {
              const result = await getApis().actions.setDeckVisibility({ deckId, isPublic: next });
              if (!result.ok) {
                setOn(previous);
                setError(result.error.message);
              }
            });
          }}
        />
        <div className="min-w-0">
          <label htmlFor="deck-public" className="block font-bold">
            {on ? "Anyone with the link can see this deck" : "Only you can see this deck"}
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            This controls the deck&rsquo;s page. Either way, the cards you run count toward how often cards are played
            with your commander, which is what the recommendations are built from.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
