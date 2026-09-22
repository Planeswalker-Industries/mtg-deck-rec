"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { decklistFromFile } from "@mtg/core/parse";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FEATURED_DECKS } from "@/lib/featured-decks";
import { CommanderLookupBar, CommanderLookupSheet } from "./commander-lookup";
import { DeckBar } from "./deck-bar";
import { readReviewView, writeReviewView, type ReviewView } from "@/lib/review-view";
import { PanelError } from "./panel-state";
import { ResolutionIssues } from "./resolution-issues";
import { FileDrop } from "@/components/collection/file-drop";
import { OpenDeckBar } from "@/components/decks/open-deck-bar";
import { SaveDeckButton } from "@/components/decks/save-deck-button";
import { ShuffleDeck } from "./shuffle-deck";
import { ToolDeckEditor, type FlushEdits } from "@/components/deckbuilder/tool-deck-editor";
import { AddPhase } from "./journey/add-phase";
import { CutPhase } from "./journey/cut-phase";
import { JourneyStepper } from "./journey/journey-stepper";
import { ReplacePhase } from "./journey/replace-phase";
import { ReviewPhase } from "./journey/review-phase";
import { useDeckJourney } from "./journey/use-deck-journey";
import { useCollectionSource } from "@/components/collection/use-collection-source";
import { useCommanderLookup } from "./use-commander-lookup";
import { useDeckGroups } from "./use-deck-groups";
import { useDeckTool } from "./use-deck-tool";

const PLACEHOLDER = `Commander
1 Liesa, Forgotten Archangel

Deck
1 Sol Ring
1 Arcane Signet
…`;

/**
 * A segmented control: one of a few options, pressed state on the chosen one. Used for the tool's mode (upgrade or
 * edit) and for how each journey phase is reviewed (swipe or list).
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            value === o.value ? "bg-sleeve text-foreground shadow-[0_1px_0_var(--seam)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "upgrade" walks the deck through the journey; "edit" is the deckbuilder. */
type ToolMode = "upgrade" | "edit";

export function DeckTool() {
  // ?deck=<code> opens one of the signed-in player's saved decks instead of the deck from their last visit.
  // ?commander=<slug> opens a featured deck from the landing page carousel.
  const searchParams = useSearchParams();
  const openCode = searchParams.get("deck");
  const commanderSlug = searchParams.get("commander");
  const { source } = useCollectionSource();
  const collectionLoaded = source.kind !== "loading";
  const tool = useDeckTool(source);
  const lookup = useCommanderLookup(tool.refreshRecommendations);
  const deckGroups = useDeckGroups(tool.lines);
  const [editing, setEditing] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [view, setView] = useState<ReviewView>(readReviewView);
  const [mode, setMode] = useState<ToolMode>("upgrade");
  const router = useRouter();
  /** The inline deckbuilder's pending-edit flush, while it is on screen, so Save saves the deck as edited. */
  const flushEdits = useRef<FlushEdits | null>(null);
  /** Review's Save on a deck that isn't saved yet opens the name form in the header. */
  const [saveAsked, setSaveAsked] = useState(false);
  const [committing, setCommitting] = useState(false);
  const restoreStarted = useRef(false);
  const { analysis, context } = tool;
  const journey = useDeckJourney({ analysis, context, lines: tool.lines, cut: tool.cut });

  /*
   * Open where the player left off: a featured deck when the link named one, a saved deck when the link
   * named one, otherwise the deck from their last visit, analyzed again. Waits for the saved collection
   * so owned-only suggestions apply from the first load.
   */
  useEffect(() => {
    if (restoreStarted.current || !collectionLoaded) return;
    restoreStarted.current = true;

    // ?commander=<slug> loads a featured deck from the landing page carousel
    if (commanderSlug !== null) {
      const featured = FEATURED_DECKS.find((d) => d.slug === commanderSlug);
      if (featured) {
        void tool.submit({ text: featured.decklist, bracketOverride: null, gameChangerOverride: null, importedFrom: null }).then((outcome) => {
          if (outcome.parsed) {
            setEditing(false);
            void lookup.check(outcome.analysis);
          }
        });
        return;
      }
      // Unknown slug falls through to the remembered deck
    }

    const opened = openCode === null ? tool.restoreLastDeck() : tool.openSavedDeck(openCode).then((r) => {
      if (r.ok) return r.data;
      setOpenError(r.error.message);
      // Fall back to the remembered deck rather than an empty box: the link failing shouldn't cost them their work.
      return tool.restoreLastDeck();
    });
    void opened.then((restored) => {
      if (!restored.parsed) return;
      setEditing(false);
      void lookup.check(restored.analysis);
    });
  }, [tool, lookup, collectionLoaded, openCode, commanderSlug]);
  const showInput = editing || !analysis;

  /** A saved deck's deckbuilder has its own address; the commander segment is decoration, the code finds the deck. */
  const editorUrl = (code: string) => `/decks/${analysis?.commanderKey.commanders[0]?.slug ?? "deck"}/${code}/edit` as Route;

  /** Edit deck: a saved deck opens in its own editor once its last change has been written; an unsaved one edits here. */
  async function changeMode(next: ToolMode) {
    const open = tool.openDeck;
    if (next === "edit" && open) {
      await tool.whenSaved();
      router.push(editorUrl(open.code));
      return;
    }
    setMode(next);
  }
  const cardCount = analysis
    ? analysis.deck.commanders.length +
      analysis.deck.cards.filter((c) => c.section === "main").reduce((n, c) => n + c.quantity, 0)
    : 0;

  function changeView(next: ReviewView) {
    setView(next);
    writeReviewView(next);
  }

  async function analyze() {
    const outcome = await tool.submit();
    setEditing(false);
    setMode("upgrade");
    if (outcome.parsed) void lookup.check(outcome.analysis);
  }

  /**
   * Ends a journey round from Review. Save and Re-analyze put the result in the decklist and analyze it; Start over goes
   * back to the deck the player brought. A new analysis starts a new round at Cut. Save then opens the editor: an open
   * account deck has just been written back by the analysis, and a deck that isn't saved yet gets the name form.
   */
  async function commitJourney(kind: "save" | "reanalyze" | "startOver") {
    const text = kind === "startOver" ? null : journey.resultText();
    if (kind !== "startOver" && text === null) return;
    setCommitting(true);
    const outcome = text === null ? await tool.startOver() : await tool.commitText(text);
    setCommitting(false);
    if (!outcome.parsed) return;
    if (kind === "save") {
      // An open deck was just written back by the analysis; once that lands, its editor has the result.
      if (tool.openDeck) {
        await tool.whenSaved();
        router.push(editorUrl(tool.openDeck.code));
        return;
      }
      setMode("edit");
      setSaveAsked(true);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* The open deck stays named while its decklist is being edited: it is still the deck being worked on. */}
      {tool.openDeck && (
        <OpenDeckBar deck={tool.openDeck} editing={showInput} onEdit={() => setEditing(true)} onClose={tool.closeSavedDeck} />
      )}
      {showInput ? (
        <section aria-labelledby="deck-input-heading" className="flex flex-col gap-4">
          <div>
            <h1 id="deck-input-heading" className="font-heading text-4xl leading-none font-extrabold tracking-tight">
              Upgrade a deck
            </h1>
            <p className="mt-2 max-w-prose text-muted-foreground">
              Paste your Commander decklist, or a link to a public Archidekt deck, to see cards to cut, cards to add, and
              replacements that do the same job.
            </p>
            {/* Two ways in: a deck first, or a collection first so suggestions can lean on cards already owned. */}
            {source.kind === "none" && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Building from cards you own?{" "}
                <Link href="/collection/import" className="font-bold text-primary underline-offset-4 hover:underline">
                  Import your collection first
                </Link>
                , and suggestions will put your cards ahead of the rest.
              </p>
            )}
            {(source.kind === "browser" || source.kind === "account") && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Your collection is loaded: suggestions put cards you own first. Change that under My collection once the deck
                is analyzed.
              </p>
            )}
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void analyze();
            }}
          >
            <Label htmlFor="decklist" className="sr-only">
              Decklist
            </Label>
            {/* A CSV deck export collapses to quantity and name: a deck is oracle-level, so the printing is noise. */}
            <FileDrop
              note=".csv or .txt from ManaBox, Moxfield, Archidekt or TCGplayer. A CSV is reduced to quantities and card names."
              disabled={tool.parse.status === "loading"}
              onFile={(contents) => tool.setText(decklistFromFile(contents))}
            />
            <Textarea
              id="decklist"
              rows={8}
              value={tool.text}
              onChange={(e) => tool.setText(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="bg-sleeve text-base sm:text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={!tool.text.trim() || tool.parse.status === "loading"}>
                {tool.parse.status === "loading" ? "Reading decklist…" : "Analyze deck"}
              </Button>
              <Button type="button" size="lg" variant="outline" onClick={tool.loadSample}>
                Use sample deck
              </Button>
              {tool.text && (
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={() => {
                    tool.clearDeck();
                    lookup.reset();
                    setEditing(true);
                  }}
                >
                  Clear
                </Button>
              )}
              {analysis && (
                <Button type="button" size="lg" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
          {!analysis && tool.parse.status === "loading" && <ShuffleDeck label="Reading your decklist" />}
        </section>
      ) : tool.openDeck ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {analysis && (
            <SaveDeckButton
              key={saveAsked ? "asked" : "idle"}
              analysis={analysis}
              bracket={context?.bracket ?? null}
              onSaved={(deck) => {
                setSaveAsked(false);
                tool.trackSavedDeck(deck);
                // Saving opens the deck in its deckbuilder, at the address it keeps from now on.
                router.push(editorUrl(deck.code));
              }}
              defaultOpen={saveAsked}
              original={tool.original}
              beforeSave={async () => (flushEdits.current ? flushEdits.current() : null)}
            />
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit decklist
          </Button>
        </div>
      )}
      {openError && (
        <p role="alert" className="text-sm text-destructive">
          {openError}
        </p>
      )}

      {tool.importedFrom && tool.parse.status === "ready" && (
        <p className="text-sm text-muted-foreground">
          Imported from{" "}
          <a href={tool.importedFrom.url} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
            Archidekt
          </a>
          . Edit the decklist to change it here.
        </p>
      )}
      {tool.parse.status === "error" && <PanelError message={tool.parse.message} />}
      <ResolutionIssues unresolved={tool.unresolvedLines} issues={analysis?.issues ?? []} />

      {analysis && context && (
        <section aria-label="Recommendations" className="flex flex-col gap-4">
          <DeckBar
            analysis={analysis}
            context={context}
            cardCount={cardCount}
            onBracketChange={tool.changeBracket}
            onIncludeGameChangersChange={tool.changeIncludeGameChangers}
            collectionMode={tool.collectionMode}
            onCollectionModeChange={tool.changeCollectionMode}
          />
          <CommanderLookupBar lookup={lookup} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="What to do with the deck"
              options={[
                { value: "upgrade", label: "Upgrade" },
                { value: "edit", label: "Deckbuilder" },
              ]}
              value={mode}
              onChange={(next) => void changeMode(next)}
            />
            {mode === "upgrade" && journey.state?.phase !== "review" && (
              <Segmented
                label="How to review cards"
                options={[
                  { value: "swipe", label: "Swipe" },
                  { value: "list", label: "List" },
                ]}
                value={view}
                onChange={changeView}
              />
            )}
          </div>
          {mode === "upgrade" ? (
            journey.state && (
              <div className="flex flex-col gap-5">
                <JourneyStepper phase={journey.state.phase} onSelect={(phase) => journey.goTo(phase)} />
                {journey.state.phase === "cut" && <CutPhase journey={journey} cutState={tool.cut} view={view} deckGroups={deckGroups} />}
                {journey.state.phase === "add" && <AddPhase journey={journey} view={view} />}
                {journey.state.phase === "replace" && (
                  <ReplacePhase journey={journey} view={view} commanderKeyId={analysis.commanderKey.id} />
                )}
                {journey.state.phase === "review" && (
                  <ReviewPhase
                    journey={journey}
                    busy={committing}
                    onSave={() => void commitJourney("save")}
                    onReanalyze={() => void commitJourney("reanalyze")}
                    onStartOver={() => void commitJourney("startOver")}
                  />
                )}
              </div>
            )
          ) : (
            // Remounted when the player pastes a new decklist, so the builder starts from it rather than its old state.
            <ToolDeckEditor key={tool.originText ?? "deck"} tool={tool} flushRef={flushEdits} />
          )}
        </section>
      )}

      <CommanderLookupSheet lookup={lookup} />
    </div>
  );
}
