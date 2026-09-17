"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { findResolvedCard } from "@/lib/cards";
import { AddPanel } from "./add-panel";
import { CommanderLookupBar, CommanderLookupSheet } from "./commander-lookup";
import { CutPanel } from "./cut-panel";
import { DeckBar } from "./deck-bar";
import { DeckGroupsPanel } from "./deck-groups-panel";
import type { Job } from "./job-selector";
import { readReviewView, writeReviewView, type ReviewView } from "@/lib/review-view";
import { PanelError } from "./panel-state";
import { ResolutionIssues } from "./resolution-issues";
import { OpenDeckBar } from "@/components/decks/open-deck-bar";
import { SaveDeckButton } from "@/components/decks/save-deck-button";
import { ShuffleDeck } from "./shuffle-deck";
import { SwapSheet } from "./swap-sheet";
import { SwipeRater, SwipeSummary } from "./swipe-rater";
import { WorkspaceNav } from "./workspace-nav";
import { WorkspaceRail } from "./workspace-rail";
import type { PickedSwap } from "./use-swipe-rater";
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

export function DeckTool() {
  // ?deck=<code> opens one of the signed-in player's saved decks instead of the deck from their last visit.
  const openCode = useSearchParams().get("deck");
  const { source } = useCollectionSource();
  const collectionLoaded = source.kind !== "loading";
  const tool = useDeckTool(source);
  const lookup = useCommanderLookup(tool.refreshRecommendations);
  const deckGroups = useDeckGroups(tool.lines);
  const [editing, setEditing] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [view, setView] = useState<ReviewView>(readReviewView);
  const [pendingSwaps, setPendingSwaps] = useState<PickedSwap[]>([]);
  // null is the deck itself, which is where the workspace starts.
  const [job, setJob] = useState<Job | null>(null);
  const [summary, setSummary] = useState<PickedSwap[] | null>(null);
  const restoreStarted = useRef(false);
  const swipeScrollWanted = useRef(false);
  const { analysis, context, swap } = tool;

  /*
   * Open where the player left off: a saved deck when the link named one, otherwise the deck from their last visit,
   * analyzed again. Waits for the saved collection so owned-only suggestions apply from the first load.
   */
  useEffect(() => {
    if (restoreStarted.current || !collectionLoaded) return;
    restoreStarted.current = true;
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
  }, [tool, lookup, collectionLoaded, openCode]);
  const showInput = editing || !analysis;
  const selectedCardId = swap?.targetCardId ?? null;
  const swapTarget = selectedCardId === null ? null : findResolvedCard(tool.lines, selectedCardId);
  const cardCount = analysis
    ? analysis.deck.commanders.length +
      analysis.deck.cards.filter((c) => c.section === "main").reduce((n, c) => n + c.quantity, 0)
    : 0;

  /** Asks for the swipe view (or its summary) to scroll just below the sticky deck bar once it shows. */
  function scrollToSwipeView() {
    swipeScrollWanted.current = true;
  }

  /**
   * The swipe view's and summary's element ref. They mount with their cards often several renders after the scroll was
   * asked for, and in a child that re-renders on its own (the deck shuffles first, and the page is too short to scroll
   * while it does), so the scroll happens here rather than in an effect.
   */
  function scrollIfWanted(element: HTMLElement | null) {
    if (!element || !swipeScrollWanted.current) return;
    swipeScrollWanted.current = false;
    element.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /** Ends a swipe sitting: shows what was picked and writes the swaps into the decklist. */
  function finishSwiping() {
    setSummary(pendingSwaps);
    if (pendingSwaps.length > 0) void tool.applySwaps(pendingSwaps);
    setPendingSwaps([]);
    scrollToSwipeView();
  }

  function changeView(next: ReviewView) {
    if (next === view) return;
    // Leaving the swipe view mid-sitting still puts the picked swaps in the deck.
    if (view === "swipe" && pendingSwaps.length > 0) void tool.applySwaps(pendingSwaps);
    setPendingSwaps([]);
    setSummary(null);
    setView(next);
    writeReviewView(next);
    if (next === "swipe") scrollToSwipeView();
  }

  async function analyze() {
    const outcome = await tool.submit();
    setEditing(false);
    if (outcome.analysis && view === "swipe") scrollToSwipeView();
    if (outcome.parsed) void lookup.check(outcome.analysis);
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
          {!analysis && view === "swipe" && tool.parse.status === "loading" && <ShuffleDeck label="Reading your decklist" />}
        </section>
      ) : tool.openDeck ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {analysis && (
            <SaveDeckButton analysis={analysis} bracket={context?.bracket ?? null} onSaved={tool.trackSavedDeck} />
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
            ownedOnly={tool.ownedOnly}
            onOwnedOnlyChange={tool.changeOwnedOnly}
          />
          <CommanderLookupBar lookup={lookup} />
          <div role="group" aria-label="How to review cards" className="inline-flex w-fit rounded-lg bg-muted p-0.5">
            {(["swipe", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => changeView(v)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  view === v ? "bg-sleeve text-foreground shadow-[0_1px_0_var(--seam)]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "swipe" ? "Swipe" : "List"}
              </button>
            ))}
          </div>
          {view === "swipe" ? (
            summary ? (
              <SwipeSummary
                swaps={summary}
                viewRef={scrollIfWanted}
                updating={tool.parse.status === "loading"}
                onSwipeAgain={() => {
                  setSummary(null);
                  scrollToSwipeView();
                }}
                onShowList={() => changeView("list")}
              />
            ) : tool.cut.status === "ready" ? (
              tool.cut.data.suggestions.length > 0 ? (
                <SwipeRater
                  targets={tool.cut.data.suggestions}
                  viewRef={scrollIfWanted}
                  context={context}
                  commanderKeyId={analysis.commanderKey.id}
                  picked={pendingSwaps}
                  onPick={(swap) => setPendingSwaps((prev) => [...prev, swap])}
                  onFinish={finishSwiping}
                />
              ) : (
                <p className="text-sm">Nothing stands out to cut. Switch to the list to compare replacements for any card.</p>
              )
            ) : tool.cut.status === "error" ? (
              <PanelError message={tool.cut.message} />
            ) : (
              <ShuffleDeck label="Finding cards to cut" />
            )
          ) : (
            /*
             * The workspace: where you are (left), what you're working on (middle) and the three jobs (right).
             *
             * One grid rather than three nested columns, so the same markup is a single stack on a phone in the
             * order the mock asks for — jobs, then cards — and three columns from `lg` up.
             */
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_17rem] lg:gap-6">
              <aside className="hidden lg:col-start-1 lg:row-start-1 lg:block">
                <WorkspaceNav deckGroups={deckGroups} showSections={job === null || job === "replace"} />
              </aside>

              <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:col-start-3 lg:row-start-1">
                <WorkspaceRail job={job} onSelect={setJob} cut={tool.cut} add={tool.add} />
              </div>

              <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
                {job === null && (
                  <DeckGroupsPanel deckGroups={deckGroups} selectedCardId={selectedCardId} onSelectCard={tool.openSwap} />
                )}
                {job === "cut" && (
                  <CutPanel
                    state={tool.cut}
                    commanderKey={analysis.commanderKey}
                    selectedCardId={selectedCardId}
                    onSelectCard={tool.openSwap}
                  />
                )}
                {job === "add" && <AddPanel state={tool.add} />}
                {job === "replace" && (
                  <>
                    {/*
                     * Replacements are per card rather than a list of their own: the question is always "what else
                     * does this card's job", so the deck is the way in.
                     */}
                    <p className="text-sm text-muted-foreground">
                      Tap any card to see what else does its job, how the two compare and what the swap costs.
                    </p>
                    <DeckGroupsPanel deckGroups={deckGroups} selectedCardId={selectedCardId} onSelectCard={tool.openSwap} />
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <SwapSheet
        swap={swap}
        target={swapTarget}
        commanderCount={tool.analysis?.commanderKey.commanders.length ?? 0}
        onClose={tool.closeSwap}
      />
      <CommanderLookupSheet lookup={lookup} />
    </div>
  );
}
