"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { findResolvedCard } from "@/lib/cards";
import { AddPanel } from "./add-panel";
import { CutPanel } from "./cut-panel";
import { DeckBar } from "./deck-bar";
import { DeckListPanel } from "./deck-list-panel";
import { PanelError } from "./panel-state";
import { ResolutionIssues } from "./resolution-issues";
import { SwapSheet } from "./swap-sheet";
import { useDeckTool } from "./use-deck-tool";

const PLACEHOLDER = `Commander
1 Chulane, Teller of Tales

Deck
1 Sol Ring
1 Arcane Signet
…`;

export function DeckTool() {
  const tool = useDeckTool();
  const [editing, setEditing] = useState(true);
  const { analysis, context, swap } = tool;
  const showInput = editing || !analysis;
  const selectedCardId = swap?.targetCardId ?? null;
  const swapTarget = selectedCardId === null ? null : findResolvedCard(tool.lines, selectedCardId);
  const cardCount = analysis
    ? analysis.deck.commanders.length +
      analysis.deck.cards.filter((c) => c.section === "main").reduce((n, c) => n + c.quantity, 0)
    : 0;

  async function analyze() {
    await tool.submit();
    setEditing(false);
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
              Paste your Commander decklist to see cards to cut, cards to add, and replacements that do the same job.
              Card data is a small sample for now.
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
          />
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
    </div>
  );
}
