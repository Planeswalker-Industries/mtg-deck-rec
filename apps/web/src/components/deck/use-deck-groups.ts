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
 * Tags are fetched only when that grouping is chosen: most visits never ask for them, and a Commander deck is a
 * hundred cards. They are kept per card for the visit, so a new deck asks only for the cards it adds. Type and keyword
 * need no request at all, because both ride on the cards the tool already holds.
 */
export function useDeckGroups(lines: ResolvedLine[]): DeckGroups {
  const [grouping, setGrouping] = useState<DeckGrouping>("type");
  const [tags, setTags] = useState<ReadonlyMap<number, TagRef[]>>(new Map());
  /** A failed request, for the cards it asked about: asking about others (a new deck) clears it. */
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const request = useRef(0);

  const entries: DeckEntry[] = useMemo(
    () =>
      lines.flatMap(({ line, resolution }) =>
        resolution.status === "resolved" && line.section === "main"
          ? [{ card: resolution.card, quantity: line.quantity }]
          : [],
      ),
    [lines],
  );
  const missing = useMemo(
    () => (grouping === "tag" ? [...new Set(entries.map((e) => e.card.id as number))].filter((id) => !tags.has(id)) : []),
    [grouping, entries, tags],
  );
  const missingKey = missing.join(",");

  // Asks for the tags of cards not seen yet, once per set of missing cards: a newer deck's request drops an older
  // one's answer, and a failed one is asked for again the next time the deck or grouping changes.
  useEffect(() => {
    if (missing.length === 0) return;
    const id = ++request.current;
    const key = missingKey;
    void getApis()
      .catalog.cardTags({ cardIds: missing as CardId[] })
      .then((result) => {
        if (id !== request.current) return;
        if (!result.ok) {
          setFailure({ key, message: result.error.message });
          return;
        }
        setTags((prev) => {
          const next = new Map(prev);
          // A card the catalog has no tags for still counts as fetched, or it would be asked for forever.
          for (const cardId of missing) if (!next.has(cardId)) next.set(cardId, []);
          for (const row of result.data) next.set(row.cardId as number, row.tags);
          return next;
        });
      });
    // Keyed on the missing cards' ids rather than the array, which is rebuilt whenever the tags arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);

  const groups = useMemo(
    () => groupDeck(entries, grouping, tags, { maxGroups: grouping === "type" ? undefined : MAX_TAG_GROUPS }),
    [entries, grouping, tags],
  );

  const tagsError = failure?.key === missingKey ? failure.message : null;
  return { grouping, setGrouping, groups, loadingTags: missing.length > 0 && tagsError === null, tagsError };
}
