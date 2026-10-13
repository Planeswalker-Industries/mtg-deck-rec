"use client";

import { useState, useTransition } from "react";
import type { DeckId } from "@mtg/core/contract";
import { Switch } from "@/components/ui/switch";
import { getApis } from "@/lib/api/client";

/** Marks a saved deck's cards as in use by that deck. */
export function DeckBuilt({ deckId, isBuilt }: { deckId: DeckId; isBuilt: boolean }) {
  const [on, setOn] = useState(isBuilt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-seam bg-sleeve/60 p-4">
      <div className="flex items-start gap-3">
        <Switch
          id="deck-built"
          checked={on}
          disabled={pending}
          onCheckedChange={(next) => {
            const previous = on;
            setOn(next);
            setError(null);
            startTransition(async () => {
              try {
                const result = await getApis().actions.setDeckBuilt({ deckId, isBuilt: next });
                if (!result.ok) {
                  setOn(previous);
                  setError(result.error.message);
                }
              } catch {
                setOn(previous);
                setError("Couldn't update this deck. Check your connection and try again.");
              }
            });
          }}
        />
        <div className="min-w-0">
          <label htmlFor="deck-built" className="block font-semibold">
            I&apos;ve built this deck
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Its cards count as in use: other decks won&apos;t be suggested them as free copies.
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
