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
}: {
  deckId: DeckId;
  code: string;
  commanderSlug: string;
  name: string;
  bracket: Bracket | null;
  deck: DeckInput;
  cards: CardSummary[];
}) {
  const [name, setName] = useState(initialName);
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
    const r = await getApis().actions.renameDeck({ deckId, name: trimmed });
    if (r.ok) {
      nameRef.current = trimmed;
      setName(trimmed);
      setRenaming(false);
    } else {
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

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        {renaming ? (
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
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">{name}</h1>
            <Button type="button" size="sm" variant="link" className="px-0" onClick={() => setRenaming(true)}>
              Rename
            </Button>
          </div>
        )}
        <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {status.kind === "error" ? `Couldn't save: ${status.message}` : STATUS_TEXT[status.kind]}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={{ pathname: "/deck", query: { deck: code } }} className={buttonVariants({ size: "sm" })}>
            Upgrade this deck
          </Link>
          <Link href={`/decks/${commanderSlug}/${code}` as Route} className={buttonVariants({ size: "sm", variant: "outline" })}>
            Deck page
          </Link>
          <Link href="/decks" className={buttonVariants({ size: "sm", variant: "ghost" })}>
            All your decks
          </Link>
        </div>
      </header>
      <DeckBuilder builder={builder} analysis={analysis} swapContext={swapContext} />
    </article>
  );
}
