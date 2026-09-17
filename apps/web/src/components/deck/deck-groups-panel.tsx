"use client";

import type { CardId, CardSummary } from "@mtg/core/contract";
import type { DeckGrouping } from "@mtg/core/scoring";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { GameChangerBadge } from "./card-label";
import { groupHeading, groupId } from "./deck-group-id";
import type { DeckGroups } from "./use-deck-groups";

const PILLS: { value: DeckGrouping; label: string }[] = [
  { value: "type", label: "Card Type" },
  { value: "keyword", label: "Keyword" },
  { value: "tag", label: "Tags" },
];

/** The deck, grouped by card type, Scryfall keyword or functional tag. The grouping itself lives in `useDeckGroups`. */
export function DeckGroupsPanel({
  deckGroups,
  selectedCardId,
  onSelectCard,
}: {
  deckGroups: DeckGroups;
  selectedCardId: CardId | null;
  onSelectCard: (cardId: CardId) => void;
}) {
  const { grouping, setGrouping, groups, loadingTags, tagsError } = deckGroups;

  return (
    <section aria-label="Your deck" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Group by</span>
        <div role="group" aria-label="Group the deck by" className="flex flex-wrap gap-1.5">
          {PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              aria-pressed={grouping === pill.value}
              onClick={() => setGrouping(pill.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                grouping === pill.value
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-seam text-muted-foreground hover:text-foreground",
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {grouping === "tag" && (
        <p className="text-sm text-muted-foreground">
          A card counts in every job it does, so these add up to more than the deck.
        </p>
      )}
      {loadingTags && (
        <p role="status" className="text-sm text-muted-foreground">
          Working out what each card does…
        </p>
      )}
      {tagsError && (
        <p role="alert" className="text-sm text-destructive">
          {tagsError}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.key} aria-labelledby={groupId(group)} className="flex flex-col gap-2">
          {/* scroll-mt clears the sticky deck bar when the sidebar's section nav jumps here. */}
          <h3 id={groupId(group)} className="scroll-mt-24 font-heading text-xl leading-none font-semibold">
            {groupHeading(group.label)}{" "}
            <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">{group.count}</span>
          </h3>
          <PocketGrid
            label={groupHeading(group.label)}
            onSelect={(card: CardSummary) => onSelectCard(card.id)}
            items={group.entries.map(({ card, quantity }) => ({
              card,
              selected: card.id === selectedCardId,
              caption:
                card.gameChanger || quantity > 1 ? (
                  <span className="flex flex-col items-start gap-0.5">
                    {card.gameChanger && <GameChangerBadge />}
                    {quantity > 1 && <span className="text-muted-foreground tabular-nums">{quantity} copies</span>}
                  </span>
                ) : undefined,
            }))}
          />
        </section>
      ))}
    </section>
  );
}
