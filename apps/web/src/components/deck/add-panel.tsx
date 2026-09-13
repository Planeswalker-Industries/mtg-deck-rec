"use client";

import type { AddResult, CardCategory } from "@mtg/core/contract";
import { Badge } from "@/components/ui/badge";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { confidenceMessage } from "@/lib/labels";
import { CardLabel } from "./card-label";
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
  if (state.status === "loading") return <PanelLoading />;
  if (state.status === "error") return <PanelError message={state.message} />;

  const { groups, confidence, commanderKey } = state.data;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">{confidenceMessage(confidence, commanderKey.deckCount)}</p>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">No additions to suggest.</p>}
      {groups.map((group) => (
        <section key={group.category} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{CATEGORY_LABEL[group.category]}</h3>
          <ul className="divide-y rounded-lg border">
            {group.suggestions.map((s) => (
              <li key={s.card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <CardLabel card={s.card} />
                {s.owned && <Badge variant="secondary">Owned</Badge>}
                <span className="flex flex-wrap gap-1">
                  {s.fillsRoles.map((role) => (
                    <Badge key={role.id} variant="outline">
                      {role.label}
                    </Badge>
                  ))}
                </span>
                <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                  {s.corpus && <span>in {formatPercent(s.corpus.inclusionRate)} of decks</span>}
                  <span title={s.card.price ? `Estimate as of ${formatAsOf(s.card.price.asOf)}` : undefined}>
                    {s.card.price ? `~${formatUsd(s.card.price.usd)}` : "No price"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
