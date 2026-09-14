"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { findResolvedCard } from "@/lib/cards";
import { AddPanel } from "./add-panel";
import { CommanderLookupBar, CommanderLookupSheet } from "./commander-lookup";
import { CutPanel } from "./cut-panel";
import { DeckBar } from "./deck-bar";
import { DeckListPanel } from "./deck-list-panel";
import { PanelError } from "./panel-state";
import { ResolutionIssues } from "./resolution-issues";
import { SwapSheet } from "./swap-sheet";
import { useStoredCollection } from "@/components/collection/use-stored-collection";
import { useCommanderLookup } from "./use-commander-lookup";
import { useDeckTool } from "./use-deck-tool";

const PLACEHOLDER = `Commander
1 Liesa, Forgotten Archangel

Deck
1 Sol Ring
1 Arcane Signet
…`;

export function DeckTool() {
  const stored = useStoredCollection();
  const collectionLoaded = stored.state.status === "ready";
  const tool = useDeckTool(stored.state.status === "ready" ? stored.state.collection : null);
  const lookup = useCommanderLookup(tool.refreshRecommendations);
  const [editing, setEditing] = useState(true);
  const restoreStarted = useRef(false);
  const { analysis, context, swap } = tool;

  // Open where the player left off: the deck from their last visit, analyzed again. Waits for the saved collection so
  // owned-only suggestions apply from the first load.
  useEffect(() => {
    if (restoreStarted.current || !collectionLoaded) return;
    restoreStarted.current = true;
    void tool.restoreLastDeck().then((restored) => {
      if (!restored.parsed) return;
      setEditing(false);
      void lookup.check(restored.analysis);
    });
  }, [tool, lookup, collectionLoaded]);
  const showInput = editing || !analysis;
  const selectedCardId = swap?.targetCardId ?? null;
  const swapTarget = selectedCardId === null ? null : findResolvedCard(tool.lines, selectedCardId);
  const cardCount = analysis
    ? analysis.deck.commanders.length +
      analysis.deck.cards.filter((c) => c.section === "main").reduce((n, c) => n + c.quantity, 0)
    : 0;

  async function analyze() {
    const outcome = await tool.submit();
    setEditing(false);
    if (outcome.parsed) void lookup.check(outcome.analysis);
  }

  return (
    <div className="flex flex-col gap-5">
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
        </section>
      ) : (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit decklist
          </Button>
        </div>
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
          <Tabs defaultValue="cut" className="gap-4">
            <TabsList className="h-10 w-full sm:w-fit">
              <TabsTrigger value="cut" className="px-3">
                Cards to cut
              </TabsTrigger>
              <TabsTrigger value="add" className="px-3">
                Cards to add
              </TabsTrigger>
              <TabsTrigger value="deck" className="px-3">
                Your deck
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cut">
              <CutPanel
                state={tool.cut}
                commanderDeckCount={analysis.commanderKey.deckCount}
                selectedCardId={selectedCardId}
                onSelectCard={tool.openSwap}
              />
            </TabsContent>
            <TabsContent value="add">
              <AddPanel state={tool.add} />
            </TabsContent>
            <TabsContent value="deck">
              <DeckListPanel lines={tool.lines} selectedCardId={selectedCardId} onSelectCard={tool.openSwap} />
            </TabsContent>
          </Tabs>
        </section>
      )}

      <SwapSheet swap={swap} target={swapTarget} onClose={tool.closeSwap} />
      <CommanderLookupSheet lookup={lookup} />
    </div>
  );
}
