"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import type { Bracket, CardSummary, DeckAnalysis, DeckId, DeckInput, RecContext } from "@mtg/core/contract";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApis } from "@/lib/api/client";
import { defaultIncludeGameChangers } from "@/lib/labels";
import { DeckBuilder } from "./deck-builder";
import { useDeckBuilder } from "./use-deck-builder";
import { ErrorText } from "@/components/ui/error-text";
import { SavedDeckCoverage } from "@/components/decks/saved-deck-coverage";
import { ArtPortraitHeader } from "@/components/ui/art-portrait-header";
import { SEAL_BUTTON, SEAL_OUTLINE_BUTTON } from "@/lib/constants";
import { displayName } from "@/lib/cards";
import { cn } from "cn";
import { Pencil } from "lucide-react";
import { CardCount } from "./card-count";

/** Edits settle this long before they are written, so a run of clicks is one save rather than one each. */
const SAVE_DEBOUNCE_MS = 800;

/** How long the "All changes saved" toast stays after a save: long enough to read, gone before the next edit. */
const SAVED_TOAST_MS = 2500;

type SaveStatus = { kind: "saved" } | { kind: "pending" } | { kind: "saving" } | { kind: "error"; message: string };

/** Nothing to subscribe to: the store below only tells the server render (false) from the hydrated one (true). */
const subscribeNothing = () => () => {};

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
  /** A save landed: the toast shows for SAVED_TOAST_MS. Counted, so a second save restarts its timer. */
  const [savedToast, setSavedToast] = useState(0);
  /** On a touch screen the first tap on the name shows the pencil and the second starts the rename. */
  const [pencilShown, setPencilShown] = useState(false);
  // True once hydrated: the toast portals into <body>, which the server render has no access to.
  const mounted = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
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
    if (r.ok) {
      setSavedToast((n) => n + 1);
      void analyze(next);
    }
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

  // Closing the tab or reloading skips the unmount above, so while an edit is unsaved the browser asks first. The
  // waiting edit is written at once, so staying (or a quick leave) keeps it.
  const unsaved = status.kind === "pending" || status.kind === "saving";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void save(pending.current);
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
    // save reads only refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved]);

  useEffect(() => {
    if (savedToast === 0) return;
    const timer = window.setTimeout(() => setSavedToast(0), SAVED_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [savedToast]);

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
      setPencilShown(false);
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

  // The lead commander's art, as on the deck's page; the commander as edited, so a new one brings its own art and
  // credit (`CardSummary.artist`). Uncredited art is never shown.
  const lead = builder.commanders[0];
  const artist = lead ? (lead.artist ?? artists[lead.id] ?? null) : null;

  const credit = artist && lead ? { cardName: displayName(lead), cardSlug: lead.slug, artist } : null;
  const headerBody = (
    <>
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenaming(false);
                setPencilShown(false);
              }}
            >
              Cancel
            </Button>
          </form>
        </>
      ) : (
        <div className="group/name relative w-fit max-w-full font-heading text-2xl leading-tight sm:text-3xl">
          <h1 id="deck-name" className="font-semibold tracking-tight">
            {name}
          </h1>
          {/*
            The whole name is the rename button, its pencil faint over the name's right side: shown on hover or keyboard
            focus, and on a touch screen by the first tap, which the second turns into the rename.
          */}
          <button
            type="button"
            title="Rename deck"
            aria-label={`Rename deck: ${name}`}
            className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onBlur={() => setPencilShown(false)}
            onClick={() => {
              if (!pencilShown && window.matchMedia("(hover: none)").matches) {
                setPencilShown(true);
                return;
              }
              setRenaming(true);
            }}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-md bg-background/50 text-primary transition-opacity",
                pencilShown ? "opacity-60" : "opacity-0 group-hover/name:opacity-60 group-has-[:focus-visible]/name:opacity-60",
              )}
            >
              <Pencil className="size-5" />
            </span>
          </button>
        </div>
      )}
      {status.kind === "error" && <ErrorText>Couldn&apos;t save: {status.message}</ErrorText>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <CardCount size={builder.size} />
        <SavedDeckCoverage deck={liveDeck} deckId={deckId} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={{ pathname: "/deck", query: { deck: code } }} className={SEAL_BUTTON}>
          Upgrade this deck
        </Link>
        <Link href={`/decks/${commanderSlug}/${code}` as Route} className={SEAL_OUTLINE_BUTTON}>
          Deck page
        </Link>
      </div>
    </>
  );

  /*
    "All changes saved" as a toast over the page, above the docked Deck stats footer below xl. Portalled to <body>; the
    live region stays mounted so a screen reader hears each save.
  */
  const toast =
    mounted &&
    createPortal(
      <div
        role="status"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--deck-stats-dock-height)+env(safe-area-inset-bottom)+1rem)] z-50 mx-auto max-w-sm xl:bottom-4"
      >
        {savedToast > 0 && (
          <p className="rounded-lg border border-seam bg-sleeve px-3 py-2 text-center text-sm shadow-lift">All changes saved</p>
        )}
      </div>,
      document.body,
    );

  return (
    <article className="flex flex-col gap-5">
      <ArtPortraitHeader art={lead?.images?.front.artCrop} credit={credit} labelledBy="deck-name" className="gap-4">
        {headerBody}
      </ArtPortraitHeader>
      <DeckBuilder builder={builder} analysis={analysis} swapContext={swapContext} />
      {toast}
    </article>
  );
}
