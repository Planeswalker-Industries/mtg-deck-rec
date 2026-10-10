"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Bracket, CardId, DeckAnalysis, DeckId, DeckInput } from "@mtg/core/contract";
import { collectionShortfall, type CollectionShortfall } from "@mtg/core/collection";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import type { CollectionSource } from "@/components/collection/use-collection-source";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";
import { addShortfallToCollection, collectionCounts } from "@/lib/deck-collection";
import { signInToSaveHref, stashPendingSave } from "@/lib/pending-save";

/** A save waiting on the player's answer about the cards their collection lacks. */
interface Confirm {
  name: string;
  deck: DeckInput;
  shortfall: CollectionShortfall[];
  names: Map<CardId, string>;
}

/** Whether the visitor is signed in, as far as the collection source knows; while it loads, the save finds out. */
const isSignedIn = (source: CollectionSource) =>
  source.kind === "account" || source.kind === "loading" || source.signedIn;

/**
 * Saves the analysed deck to the signed-in user's account. Saving is deliberately explicit: a new deck is public,
 * so a throwaway paste must never become a page on its own.
 *
 * When the player has a collection, cards the deck uses more copies of than they own are listed before saving, with
 * a separate choice to add them to the collection. A signed-out player is sent to sign in
 * with the deck (and any copies they chose to add) kept for them, and the tool finishes the save when they come back.
 *
 * Once it has been saved the tool goes on editing that deck, so this hands the deck over through `onSaved` and has
 * nothing more to say.
 */
export function SaveDeckButton({
  analysis,
  bracket,
  onSaved,
  defaultOpen = false,
  original,
  beforeSave,
  collection,
  defaultName,
}: {
  analysis: DeckAnalysis;
  /**
   * The bracket the player chose, stored with the deck so reopening it comes back the same. Null while the bracket is
   * only estimated: an estimate isn't pinned, so reopening estimates it again from the cards the deck has by then.
   */
  bracket: Bracket | null;
  onSaved: (deck: { deckId: DeckId; code: string; name: string }) => void;
  /** Opens on the name form, for when the player has already asked to save (the journey's Review). */
  defaultOpen?: boolean;
  /** The deck the player brought, when the tool changed it: kept beside the saved deck as its original. */
  original?: DeckInput | undefined;
  /**
   * Runs before the write and may hand back a newer analysis to save instead, e.g. the deckbuilder's edit that was
   * still waiting to go into the decklist.
   */
  beforeSave?: (() => Promise<DeckAnalysis | null>) | undefined;
  /** The player's collection, which the deck is checked against. */
  collection: CollectionSource;
  /** A name the player already gave the deck, offered in place of its commanders' names. */
  defaultName?: string | null | undefined;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState(() => defaultName ?? suggestedDeckName(analysis));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const signedIn = isSignedIn(collection);

  /** Keeps the deck for after sign-in and goes there. */
  function signInToSave(deckName: string, deck: DeckInput) {
    stashPendingSave({ name: deckName, deck, bracket, original });
    router.push(signInToSaveHref() as Route);
  }

  /** Adds the chosen copies to the collection, then saves the deck (or hands it over to sign-in). */
  async function finish(deckName: string, deck: DeckInput, add: CollectionShortfall[], names: Map<CardId, string>) {
    setBusy(true);
    setError(null);
    try {
      await addShortfallToCollection(collection, signedIn, add, names);
    } catch (err) {
      setBusy(false);
      setError(`Couldn't add the cards to your collection: ${err instanceof Error ? err.message : "try again."}`);
      return;
    }
    if (!signedIn) {
      signInToSave(deckName, deck);
      return;
    }
    const result = await getApis().actions.saveDeck({
      name: deckName,
      deck,
      isPublic: true,
      ...(bracket === null ? {} : { bracket }),
      ...(original ? { original } : {}),
    });
    setBusy(false);
    if (result.ok) {
      setConfirm(null);
      onSaved({ ...result.data, name: deckName });
    } else if (result.error.code === "UNAUTHENTICATED") signInToSave(deckName, deck);
    else setError(result.error.message);
  }

  /** Checks an existing collection for missing cards, or saves straight away. */
  async function submit(deckName: string) {
    setBusy(true);
    setError(null);
    const fresh = beforeSave ? await beforeSave() : null;
    const deck = (fresh ?? analysis).deck;
    if (collection.kind === "none") {
      await finish(deckName, deck, [], new Map());
      return;
    }
    const shortfall = collectionShortfall(deck, await collectionCounts(collection));
    if (shortfall.length === 0) {
      await finish(deckName, deck, [], new Map());
      return;
    }
    const cards = await getApis().catalog.collectionCards({ cardIds: shortfall.map((s) => s.cardId), setCodes: [] });
    const names = new Map(cards.ok ? cards.data.cards.map(({ card }) => [card.id, displayName(card)] as const) : []);
    setBusy(false);
    setConfirm({ name: deckName, deck, shortfall, names });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Save deck
      </Button>
    );
  }

  const listed = confirm
    ? [...confirm.shortfall].sort((a, b) => (confirm.names.get(a.cardId) ?? "").localeCompare(confirm.names.get(b.cardId) ?? ""))
    : [];
  const missingCards = confirm?.shortfall.reduce((total, { missing }) => total + missing, 0) ?? 0;

  return (
    <>
      <form
        className="flex flex-wrap items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed || busy) return;
          void submit(trimmed);
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
        {!signedIn && <p className="w-full text-right text-xs text-muted-foreground">You&apos;ll sign in to save it; the deck comes with you.</p>}
        {error && !confirm && (
          <p role="alert" className="w-full text-right text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      <Sheet open={confirm !== null} onOpenChange={(next) => !next && !busy && setConfirm(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[92dvh] w-full max-w-xl gap-0 overflow-y-auto rounded-t-2xl border-seam bg-sleeve px-4 pt-5 pb-6"
        >
          <SheetHeader className="p-0 pr-8">
            <SheetTitle className="font-heading text-xl font-semibold tracking-tight">
              {missingCards} {missingCards === 1 ? "card isn't" : "cards aren't"} in your collection
            </SheetTitle>
            <SheetDescription>The deck saves either way. Your collection only changes if you say you own these.</SheetDescription>
          </SheetHeader>
          <ul className="mt-3 columns-2 gap-4 text-sm">
            {listed.map(({ cardId, missing }) => (
              <li key={cardId} className="break-inside-avoid">
                <span className="font-mono tabular-nums">{missing}×</span> {confirm?.names.get(cardId) ?? "Unknown card"}
              </li>
            ))}
          </ul>
          {!signedIn && (
            <p className="mt-3 text-sm text-muted-foreground">
              Next you&apos;ll sign in, with Google or your email, to save your deck.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <SheetFooter className="mt-4 flex-row flex-wrap justify-end gap-2 p-0">
            <Button
              type="button"
              disabled={busy}
              onClick={() => confirm && void finish(confirm.name, confirm.deck, [], confirm.names)}
            >
              {busy ? "Saving…" : "Save deck"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => confirm && void finish(confirm.name, confirm.deck, confirm.shortfall, confirm.names)}
            >
              I own these — add them and save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * What a deck is called until the player names it: its commanders. Prefilled in the save form, so saving is one click
 * for anyone who doesn't care about the name.
 */
export function suggestedDeckName(analysis: DeckAnalysis): string {
  const names = analysis.commanderKey.commanders.map(displayName);
  return names.length === 0 ? "My Commander deck" : names.join(" and ").slice(0, MAX_DECK_NAME_CHARS);
}
