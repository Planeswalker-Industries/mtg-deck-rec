"use client";

import type { AddResult, CommanderKeyRef, CorpusConfidence } from "@mtg/core/contract";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { cardCategoryLabel, commanderDecksPhrase, fewDecksPhrase } from "@/lib/labels";
import { GameChangerBadge, OwnedBadge } from "./card-label";
import { PanelError, PanelLoading } from "./panel-state";
import type { Async } from "./use-deck-tool";

function introFor(confidence: CorpusConfidence, key: CommanderKeyRef): string {
  switch (confidence) {
    case "full":
      return `Cards that ${commanderDecksPhrase(key)} play and yours doesn't.`;
    case "low":
      return `Cards that ${commanderDecksPhrase(key)} play and yours doesn't. That's limited data, so cards played widely in these colors count for more.`;
    case "none":
      return `Cards widely played in Commander decks of these colors that yours doesn't run. ${fewDecksPhrase(key)}, so these aren't specific to it.`;
  }
}

export function AddPanel({ state }: { state: Async<AddResult> }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <PanelLoading label="Finding cards to add" />;
  if (state.status === "error") return <PanelError message={state.message} />;

  const { groups, confidence, commanderKey, mode } = state.data;
  const asOf = groups.flatMap((g) => g.suggestions).find((s) => s.card.price)?.card.price?.asOf;

  if (groups.length === 0) {
    return (
      <p className="max-w-prose text-sm">
        {mode === "collection_aware"
          ? "Nothing in your collection fits this deck's colors that it doesn't already run. Set My collection to Owned first to see everything."
          : confidence === "none"
            ? "Cards to add come from what other players run. That deck data isn't loaded yet, so there's nothing to suggest here for now."
            : "No additions to suggest."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">{introFor(confidence, commanderKey)}</p>
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`add-${group.category}`} className="flex flex-col gap-2">
          <h3 id={`add-${group.category}`} className="font-heading text-xl font-extrabold tracking-tight">
            {cardCategoryLabel[group.category]}{" "}
            <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">{group.suggestions.length}</span>
          </h3>
          <PocketGrid zoomable
            label={cardCategoryLabel[group.category]}
            items={group.suggestions.map((s) => ({
              card: s.card,
              caption: (
                <span className="flex flex-col items-start gap-0.5">
                  {s.card.gameChanger && <GameChangerBadge />}
                  {s.owned && <OwnedBadge />}
                  {s.fillsRoles.length > 0 && <span className="font-bold">Adds {s.fillsRoles.map((r) => r.label.toLowerCase()).join(", ")}</span>}
                  {s.corpus && (
                    <span className="text-muted-foreground tabular-nums">
                      {s.corpus.limited ? "New card, little play data yet" : `In ${formatPercent(s.corpus.inclusionRate)} of decks`}
                    </span>
                  )}
                  <span className="text-muted-foreground tabular-nums">
                    {s.card.price ? `About ${formatUsd(s.card.price.usd)}` : "No price"}
                  </span>
                </span>
              ),
            }))}
          />
        </section>
      ))}
      {asOf && <p className="text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(asOf)}.</p>}
    </div>
  );
}
