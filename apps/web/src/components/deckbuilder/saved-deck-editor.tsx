"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { Bracket, CardSummary, DeckAnalysis, DeckId, DeckInput, RecContext } from "@mtg/core/contract";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApis } from "@/lib/api/client";
import { defaultIncludeGameChangers } from "@/lib/labels";
import { DeckBuilder } from "./deck-builder";
import { useDeckBuilder } from "./use-deck-builder";
import { ErrorText } from "@/components/ui/error-text";
import { SavedDeckCoverage } from "@/components/decks/saved-deck-coverage";
import { ArtHeader } from "@/components/ui/art-header";
import { displayName } from "@/lib/cards";
import { cn } from "cn";
import { Pencil } from "lucide-react";
import { CardCount } from "./card-count";

/** Edits settle this long before they are written, so a run of clicks is one save rather than one each. */
const SAVE_DEBOUNCE_MS = 800;

type SaveStatus = { kind: "saved" } | { kind: "pending" } | { kind: "saving" } | { kind: "error"; message: string };

const STATUS_TEXT: Record<Exclude<SaveStatus["kind"], "error">, string> = {
  saved: "All changes saved",
  pending: "Unsaved changes",
  saving: "Saving…",
};

/**
 * A saved deck in the deckbuilder. Every edit is written back to the account on its own, a moment after the last
 * one, and the deck is read again (legality, bracket) so the problems list and the replacement sheet keep up.
 *
 * Only the cards are written: the bracket stays what it was saved at and visibility is the deck page's to set, the
 * same rules the deck tool's auto-save follows.
 */
export function SavedDeckEditor({
  deckId,
  code,
  commanderSlug,
  name: initialName,
  bracket,
  deck,
  cards,
  artists,
}: {
  deckId: DeckId;
  code: string;
  commanderSlug: string;
  name: string;
  bracket: Bracket | null;
  deck: DeckInput;
  cards: CardSummary[];
  /** Each commander's artist, for the header's art credit. */
  artists: Record<number, string | null>;
}) {
  const [name, setName] = useState(initialName);
  /** The deck as edited, for the coverage read; saving lags it by the debounce. */
  const [liveDeck, setLiveDeck] = useState(deck);
  /**
   * The name every save writes. A ref as well as state: the save that runs when the page is left belongs to the first
   * render, and would otherwise write the name the deck had then, undoing a rename.
   */
  const nameRef = useRef(initialName);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(initialName);
  const [status, setStatus] = useState<SaveStatus>({ kind: "saved" });
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<DeckInput | null>(null);
  const saveRequest = useRef(0);
  const analyzeRequest = useRef(0);

  async function analyze(next: DeckInput) {
    const id = ++analyzeRequest.current;
    const r = await getApis().actions.analyzeDeck({ deck: next });
    if (id === analyzeRequest.current && r.ok) setAnalysis(r.data);
  }

  // The deck is read once on arrival; after that, each save reads it again. Leaving the page writes an edit that was
  // still waiting for its pause, rather than losing it.
  useEffect(() => {
    void analyze(deck);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void save(pending.current);
    };
    // Only the deck the page arrived with: later versions are analyzed as they are saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(next: DeckInput) {
    pending.current = null;
    const id = ++saveRequest.current;
    setStatus({ kind: "saving" });
    const r = await getApis().actions.saveDeck({ deckId, name: nameRef.current, deck: next, isPublic: true });
    if (id !== saveRequest.current) return;
    setStatus(r.ok ? { kind: "saved" } : { kind: "error", message: r.error.message });
    if (r.ok) void analyze(next);
  }

  const builder = useDeckBuilder({
    initialDeck: deck,
    initialCards: cards,
    onChange: (next: DeckInput) => {
      setLiveDeck(next);
      setStatus({ kind: "pending" });
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS);
    },
  });

  async function rename() {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === name) {
      setRenaming(false);
      return;
    }
    // Every save writes the name, so a save sent while the rename is on its way must already carry the new one, or it
    // would land after the rename and put the old name back.
    const previous = nameRef.current;
    nameRef.current = trimmed;
    const r = await getApis().actions.renameDeck({ deckId, name: trimmed });
    if (r.ok) {
      setName(trimmed);
      setRenaming(false);
    } else {
      nameRef.current = previous;
      setStatus({ kind: "error", message: r.error.message });
    }
  }

  const effectiveBracket = bracket ?? analysis?.estimatedBracket ?? null;
  const swapContext: RecContext | null =
    analysis && effectiveBracket !== null
      ? {
          deck: builder.deck,
          bracket: effectiveBracket,
          bracketSource: bracket === null ? "inferred" : "user",
          includeGameChangers: defaultIncludeGameChangers(effectiveBracket),
          ownership: null,
        }
      : null;

  // The lead commander's art, as on the deck's page; the commander as edited, so a new one brings its own art.
  const lead = builder.commanders[0];
  const artist = lead ? (artists[lead.id] ?? null) : null;

  return (
    <article className="flex flex-col gap-5">
      <ArtHeader
        art={lead?.images?.front.artCrop}
        credit={artist && lead ? { cardName: displayName(lead), cardSlug: lead.slug, artist } : null}
        labelledBy="deck-name"
        className="flex min-h-32 flex-col justify-end gap-3 p-4 sm:min-h-40 sm:p-6"
      >
        {renaming ? (
          <>
            {/* The sheet stays named by the deck while its name is being edited. */}
            <h1 id="deck-name" className="sr-only">
              {name}
            </h1>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <Input
                autoFocus
                aria-label="Deck name"
                value={draftName}
                maxLength={MAX_DECK_NAME_CHARS}
                onChange={(e) => setDraftName(e.target.value)}
                className="max-w-sm bg-sleeve"
              />
              <Button type="submit" size="sm">
                Rename
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          </>
        ) : (
          <div className="font-heading text-2xl leading-tight sm:text-3xl">
            {/* Inline, so the pencil follows the name's last word when it wraps; a sibling keeps it out of the heading's name. */}
            <h1 id="deck-name" className="inline font-semibold tracking-tight">
              {name}
            </h1>
            <Button
              type="button"
              size="icon-lg"
              variant="ghost"
              title="Rename deck"
              aria-label={`Rename deck: ${name}`}
              className="ml-1.5 bg-background/70 align-middle text-primary"
              onClick={() => setRenaming(true)}
            >
              <Pencil aria-hidden className="size-5" />
            </Button>
          </div>
        )}
        {status.kind === "error" ? (
          <ErrorText>Couldn&apos;t save: {status.message}</ErrorText>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {STATUS_TEXT[status.kind]}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <CardCount size={builder.size} />
          <SavedDeckCoverage deck={liveDeck} deckId={deckId} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={{ pathname: "/deck", query: { deck: code } }} className={buttonVariants({ size: "sm" })}>
            Upgrade this deck
          </Link>
          <Link
            href={`/decks/${commanderSlug}/${code}` as Route}
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "bg-background/70")}
          >
            Deck page
          </Link>
        </div>
      </ArtHeader>
      <DeckBuilder builder={builder} analysis={analysis} swapContext={swapContext} />
    </article>
  );
}
