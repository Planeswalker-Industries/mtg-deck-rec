"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeckId, DeckInput } from "@mtg/core/contract";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { getApis } from "@/lib/api/client";
import { formatAsOf } from "@/lib/format";
import type { DeckOriginal as DeckOriginalData } from "@/lib/server/deck-page";

/**
 * How the deck differs from the one its owner first brought, and for the owner a way to put that one back.
 *
 * Restoring writes the original's cards over the deck through the same save every edit uses; the original itself
 * stays, so a restored deck can be run through the tool again and the comparison starts from the same place.
 */
export function DeckOriginal({
  deckId,
  name,
  isOwner,
  original,
}: {
  deckId: DeckId;
  name: string;
  isOwner: boolean;
  original: DeckOriginalData;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = original.out.length === 0 && original.in.length === 0;
  const copies = (list: DeckOriginalData["out"]) => list.reduce((n, c) => n + c.quantity, 0);

  async function restore(deck: DeckInput) {
    setBusy(true);
    setError(null);
    const result = await getApis().actions.saveDeck({ deckId, name, deck, isPublic: true });
    setBusy(false);
    setConfirming(false);
    if (result.ok) router.refresh();
    else setError(result.error.message);
  }

  const grid = (list: DeckOriginalData["out"], label: string, mark: "cut" | "add") => (
    <PocketGrid
      zoomable
      label={label}
      items={list.map(({ card, quantity }) => ({
        card,
        mark,
        href: `/card/${card.slug}`,
        ...(quantity > 1 ? { caption: <span className="tabular-nums">×{quantity}</span> } : {}),
      }))}
    />
  );

  return (
    <section aria-labelledby="deck-original" className="flex flex-col gap-4 rounded-lg border border-seam bg-sleeve p-4">
      <div>
        <h2 id="deck-original" className="font-heading text-2xl font-semibold tracking-tight">
          Changes from the original
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {unchanged
            ? `This deck matches the list it started from on ${formatAsOf(original.savedAt)}.`
            : `${copies(original.out)} out and ${copies(original.in)} in since the list it started from on ${formatAsOf(original.savedAt)}.`}
        </p>
      </div>

      {original.out.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-lg font-semibold text-cut">Out</h3>
          {grid(original.out, "Cards taken out since the original", "cut")}
        </div>
      )}
      {original.in.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-lg font-semibold text-add">In</h3>
          {grid(original.in, "Cards put in since the original", "add")}
        </div>
      )}

      {isOwner && !unchanged && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm">Replace this deck&apos;s cards with the original list?</span>
              <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void restore(original.deck)}>
                {busy ? "Restoring…" : "Restore original"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Keep this version
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
              Restore original
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
