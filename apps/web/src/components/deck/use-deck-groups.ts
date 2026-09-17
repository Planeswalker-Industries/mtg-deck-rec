"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardId, ResolvedLine, TagRef } from "@mtg/core/contract";
import { groupDeck, type DeckEntry, type DeckGroup, type DeckGrouping } from "@mtg/core/scoring";
import { getApis } from "@/lib/api/client";

/** Tags are far finer-grained than card types, so the list needs a ceiling; see groupDeck. */
const MAX_TAG_GROUPS = 12;

export interface DeckGroups {
  grouping: DeckGrouping;
  setGrouping: (grouping: DeckGrouping) => void;
  groups: DeckGroup[];
  loadingTags: boolean;
  tagsError: string | null;
}

/**
 * Groups the deck by card type, Scryfall keyword or functional tag.
 *
 * This sits above the panel that draws the groups because the workspace's section nav lists the same groups from the
 * sidebar: both need the grouping choice and its result, and neither owns the other.
 *
 * Tags are fetched only when that grouping is first chosen: most visits never ask for them, and a Commander deck is a
 * hundred cards. Type and keyword need no request at all, because both ride on the cards the tool already holds.
 */
export function useDeckGroups(lines: ResolvedLine[]): DeckGroups {
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
      .catalog.cardTags({ cardIds: entries.map((e) => e.card.id as CardId) })
      .then((result) => {
        if (result.ok) setTags(new Map(result.data.map((row) => [row.cardId as number, row.tags])));
        else {
          // Let it be asked for again rather than leaving the grouping permanently broken.
          asked.current = false;
          setTagsError(result.error.message);
        }
      });
  }, [grouping, entries]);

  const groups = useMemo(
    () => groupDeck(entries, grouping, tags ?? new Map(), { maxGroups: grouping === "type" ? undefined : MAX_TAG_GROUPS }),
    [entries, grouping, tags],
  );

  return { grouping, setGrouping, groups, loadingTags: grouping === "tag" && tags === null && tagsError === null, tagsError };
}
