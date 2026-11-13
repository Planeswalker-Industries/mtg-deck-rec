"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { DeckId, DeckInput } from "@mtg/core/contract";
import { cn } from "cn";
import { CardPlate } from "@/components/cards/card-plate";
import { PocketGrid } from "@/components/cards/pocket-grid";
import type { DeckView } from "@/components/decks/deck-view";
import { Button } from "@/components/ui/button";
import { getApis } from "@/lib/api/client";
import { formatAsOf } from "@/lib/format";
import type { DeckOriginal as DeckOriginalData } from "@/lib/server/deck-page";
import { ErrorText } from "@/components/ui/error-text";

/**
 * How the deck differs from the one its owner first brought, and for the owner a way to put that one back.
 *
 * Restoring writes the original's cards over the deck through the same save every edit uses; the original itself
 * stays, so a restored deck can be run through the tool again and the comparison starts from the same place.
 * The heading folds the cards away. The out-and-in count is read out only; a deck that matches its original says so.
 */
export function DeckOriginal({
  deckId,
  name,
  isOwner,
  original,
  view,
}: {
  deckId: DeckId;
  name: string;
  isOwner: boolean;
  original: DeckOriginalData;
  view: DeckView;
}) {
  const router = useRouter();
  const bodyId = useId();
  const [open, setOpen] = useState(true);
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

  const grid = (list: DeckOriginalData["out"], label: string, mark: "cut" | "add") =>
    view === "plates" ? (
      <ul aria-label={label} className="flex flex-col gap-1.5">
        {list.map(({ card, quantity }) => (
          <CardPlate key={card.id} card={card} quantity={quantity} mark={mark} />
        ))}
      </ul>
    ) : (
      <PocketGrid
        zoomable
        label={label}
        items={list.map(({ card, quantity }) => ({
          card,
          mark,
          href: `/card/${card.slug}`,
          ...(quantity > 1 ? { caption: <span className="font-mono">×{quantity}</span> } : {}),
        }))}
      />
    );

  return (
    <section aria-labelledby="deck-original" className="flex flex-col gap-4 rounded-lg border border-seam bg-sleeve p-4">
      <div>
        <h2 id="deck-original">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-11 items-center gap-2 rounded-md font-heading text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ChevronDown aria-hidden className={cn("size-5 text-primary transition-transform", !open && "-rotate-90")} />
            Changelog
          </button>
        </h2>
        <p className={unchanged ? "mt-1 text-sm text-muted-foreground" : "sr-only"}>
          {unchanged
            ? `This deck matches the list it started from on ${formatAsOf(original.savedAt)}.`
            : `${copies(original.out)} out and ${copies(original.in)} in since the list it started from on ${formatAsOf(original.savedAt)}.`}
        </p>
      </div>

      {open && (
        <div id={bodyId} className="flex flex-col gap-4">
          {/* Plates sit Out beside In, as on Finish; images need the width, so they stack. */}
          <div className={view === "plates" ? "grid grid-cols-2 items-start gap-x-3" : "flex flex-col gap-4"}>
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
          </div>

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
        </div>
      )}
      {error && (
        <ErrorText>
          {error}
        </ErrorText>
      )}
    </section>
  );
}
