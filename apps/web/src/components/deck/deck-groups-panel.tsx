"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardId, CardSummary, ResolvedLine, TagRef } from "@mtg/core/contract";
import { groupDeck, type DeckEntry, type DeckGrouping } from "@mtg/core/scoring";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { getApis } from "@/lib/api/client";
import { GameChangerBadge } from "./card-label";

/** Tagger labels are lowercase ("spot removal"); a heading reads better capitalised. */
const heading = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

const PILLS: { value: DeckGrouping; label: string }[] = [
  { value: "type", label: "Card Type" },
  { value: "keyword", label: "Keyword" },
  { value: "tag", label: "Tags" },
];

/**
 * The deck, grouped by card type, Scryfall keyword or functional tag.
 *
 * Tags are fetched only when that pill is first chosen: most visits never ask for them, and a Commander deck is a
 * hundred cards. Type and keyword need no request at all, because both ride on the cards the tool already holds.
 */
export function DeckGroupsPanel({
  lines,
  selectedCardId,
  onSelectCard,
}: {
  lines: ResolvedLine[];
  selectedCardId: CardId | null;
  onSelectCard: (cardId: CardId) => void;
}) {
  const [grouping, setGrouping] = useState<DeckGrouping>("type");
  const [tags, setTags] = useState<Map<number, TagRef[]> | null>(null);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const asked = useRef(false);

  const entries: DeckEntry[] = useMemo(
    () =>
      lines.flatMap(({ line, resolution }) =>
        resolution.status === "resolved" && line.section === "main"
          ? [{ card: resolution.card, quantity: line.quantity }]
          : [],
      ),
    [lines],
  );

  useEffect(() => {
    if (grouping !== "tag" || asked.current || entries.length === 0) return;
    asked.current = true;
    setTagsError(null);
    void getApis()
      .catalog.cardTags({ cardIds: entries.map((e) => e.card.id) })
      .then((result) => {
        if (result.ok) setTags(new Map(result.data.map((row) => [row.cardId as number, row.tags])));
        else {
          // Let it be asked for again rather than leaving the pill permanently broken.
          asked.current = false;
          setTagsError(result.error.message);
        }
      });
  }, [grouping, entries]);

  // Tags are far finer-grained than card types, so the list needs a ceiling; see groupDeck.
  const groups = useMemo(
    () => groupDeck(entries, grouping, tags ?? new Map(), { maxGroups: grouping === "type" ? undefined : 12 }),
    [entries, grouping, tags],
  );
  const loadingTags = grouping === "tag" && tags === null && tagsError === null;

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
        <section key={group.key} aria-labelledby={`deck-group-${group.key}`} className="flex flex-col gap-2">
          <h3 id={`deck-group-${group.key}`} className="font-heading text-xl leading-none font-semibold">
            {heading(group.label)}{" "}
            <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">{group.count}</span>
          </h3>
          <PocketGrid
            label={heading(group.label)}
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
