"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AddPanel } from "./add-panel";
import { ColorIdentity } from "./color-identity";
import { CutPanel } from "./cut-panel";
import { DeckControls } from "./deck-controls";
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
  const { analysis, context, swap } = tool;
  const selectedCardId = swap?.targetCardId ?? null;
  const targetName =
    tool.lines.find((l) => l.resolution.status === "resolved" && l.resolution.card.id === selectedCardId)?.line.name ??
    null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Deck tool</h1>
        <p className="text-sm text-muted-foreground">
          Paste a Commander decklist. Nothing is saved — this runs on sample data until the card database is connected.
        </p>
      </header>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void tool.submit();
        }}
      >
        <Label htmlFor="decklist" className="sr-only">
          Decklist
        </Label>
        <Textarea
          id="decklist"
          rows={10}
          value={tool.text}
          onChange={(e) => tool.setText(e.target.value)}
          placeholder={PLACEHOLDER}
          className="font-mono text-sm"
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={!tool.text.trim() || tool.parse.status === "loading"}>
            {tool.parse.status === "loading" ? "Analyzing…" : "Analyze deck"}
          </Button>
          <Button type="button" variant="outline" onClick={tool.loadSample}>
            Use sample deck
          </Button>
        </div>
      </form>

      {tool.parse.status === "error" && <PanelError message={tool.parse.message} />}
      <ResolutionIssues unresolved={tool.unresolvedLines} issues={analysis?.issues ?? []} />

      {analysis && context && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-heading text-lg font-medium">
              {analysis.commanderKey.commanders.map((c) => c.name).join(" + ")}
            </h2>
            <ColorIdentity identity={analysis.colorIdentity} />
          </div>

          <DeckControls
            bracket={context.bracket}
            bracketSource={context.bracketSource}
            estimatedBracket={analysis.estimatedBracket}
            gameChangerCount={analysis.gameChangerIds.length}
            includeGameChangers={context.includeGameChangers}
            onBracketChange={tool.changeBracket}
            onIncludeGameChangersChange={tool.changeIncludeGameChangers}
          />

          <Tabs defaultValue="cut">
            <TabsList>
              <TabsTrigger value="cut">Cards to cut</TabsTrigger>
              <TabsTrigger value="add">Cards to add</TabsTrigger>
              <TabsTrigger value="deck">Whole deck</TabsTrigger>
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

      <SwapSheet swap={swap} targetName={targetName} onClose={tool.closeSwap} />
    </div>
  );
}
