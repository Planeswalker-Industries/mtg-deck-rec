"use client";

import type { AddResult, CardCategory } from "@mtg/core/contract";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { confidenceMessage } from "@/lib/labels";
import { GameChangerBadge, OwnedBadge } from "./card-label";
import { PanelError, PanelLoading } from "./panel-state";
import type { Async } from "./use-deck-tool";

const CATEGORY_LABEL: Record<CardCategory, string> = {
  creature: "Creatures",
  instant: "Instants",
  sorcery: "Sorceries",
  artifact: "Artifacts",
  enchantment: "Enchantments",
  planeswalker: "Planeswalkers",
  battle: "Battles",
  land: "Lands",
};

export function AddPanel({ state }: { state: Async<AddResult> }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <PanelLoading label="Finding cards to add" />;
  if (state.status === "error") return <PanelError message={state.message} />;

  const { groups, confidence, commanderKey } = state.data;
  const asOf = groups.flatMap((g) => g.suggestions).find((s) => s.card.price)?.card.price?.asOf;

  if (groups.length === 0) {
    return (
      <p className="max-w-prose text-sm">
        {confidence === "none"
          ? "Cards to add come from what other players run with this commander. That deck data isn't loaded yet, so there's nothing to suggest here for now."
          : "No additions to suggest."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        Cards that decks with this commander play and yours doesn&apos;t. {confidenceMessage(confidence, commanderKey.deckCount)}
      </p>
      {groups.map((group) => (
        <section key={group.category} aria-labelledby={`add-${group.category}`} className="flex flex-col gap-2">
          <h3 id={`add-${group.category}`} className="font-heading text-xl font-extrabold tracking-tight">
            {CATEGORY_LABEL[group.category]}{" "}
            <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">{group.suggestions.length}</span>
          </h3>
          <PocketGrid
            label={CATEGORY_LABEL[group.category]}
            items={group.suggestions.map((s) => ({
              card: s.card,
              caption: (
                <span className="flex flex-col items-start gap-0.5">
                  {s.card.gameChanger && <GameChangerBadge />}
                  {s.owned && <OwnedBadge />}
                  {s.corpus && (
                    <span className="text-muted-foreground tabular-nums">In {formatPercent(s.corpus.inclusionRate)} of decks</span>
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
