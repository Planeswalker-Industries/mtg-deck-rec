"use client";

import type { AddResult, CutResult } from "@mtg/core/contract";
import { cn } from "cn";
import { formatPercent, formatUsd } from "@/lib/format";
import { cutReasonShortLabel, HARD_CUT_REASONS } from "@/lib/labels";
import { JobNote, JobPreview } from "./job-preview";
import { JobSelector, type Job } from "./job-selector";
import type { Async } from "./use-deck-tool";

/**
 * The workspace's right column: the three jobs, and the best thing each has to say.
 *
 * Suggestions are already ranked, so the first one is the preview. A job with no suggestions yet says so rather than
 * leaving a gap, because "still working" and "nothing to do" are different answers.
 */
export function WorkspaceRail({
  job,
  onSelect,
  cut,
  add,
}: {
  job: Job | null;
  onSelect: (job: Job | null) => void;
  cut: Async<CutResult>;
  add: Async<AddResult>;
}) {
  const cutCount = cut.status === "ready" ? cut.data.suggestions.length : undefined;
  const addSuggestions = add.status === "ready" ? add.data.groups.flatMap((g) => g.suggestions) : [];
  const addCount = add.status === "ready" ? addSuggestions.length : undefined;

  const topCut = cut.status === "ready" ? cut.data.suggestions[0] : undefined;
  const topAdd = addSuggestions[0];

  return (
    <JobSelector
      selected={job}
      onSelect={onSelect}
      counts={{ cut: cutCount, add: addCount }}
      previews={{
        cut: topCut ? (
          <JobPreview
            card={topCut.card}
            count={cutCount ?? 0}
            onViewAll={() => onSelect("cut")}
            note={
              <>
                {topCut.reasons
                  .filter((r) => r !== "GAME_CHANGER_EXCLUDED")
                  .slice(0, 2)
                  .map((reason) => (
                    <span key={reason} className={cn(HARD_CUT_REASONS.has(reason) ? "font-bold text-destructive" : "text-muted-foreground")}>
                      {cutReasonShortLabel[reason]}
                    </span>
                  ))}
                {topCut.corpus && (
                  <span className="text-muted-foreground tabular-nums">In {formatPercent(topCut.corpus.inclusionRate)} of decks</span>
                )}
              </>
            }
          />
        ) : (
          <JobNote>{cut.status === "ready" ? "Nothing stands out to cut." : "Working out what this deck can spare…"}</JobNote>
        ),
        add: topAdd ? (
          <JobPreview
            card={topAdd.card}
            count={addCount ?? 0}
            onViewAll={() => onSelect("add")}
            note={
              <>
                {topAdd.fillsRoles.length > 0 && <span className="font-bold">Adds {topAdd.fillsRoles.map((r) => r.label.toLowerCase()).join(", ")}</span>}
                {topAdd.corpus && !topAdd.corpus.limited && (
                  <span className="text-muted-foreground tabular-nums">In {formatPercent(topAdd.corpus.inclusionRate)} of decks</span>
                )}
                <span className="text-muted-foreground tabular-nums">
                  {topAdd.card.price ? `About ${formatUsd(topAdd.card.price.usd)}` : "No price"}
                </span>
              </>
            }
          />
        ) : (
          <JobNote>{add.status === "ready" ? "Nothing to add that this deck isn't already running." : "Looking for what this deck is missing…"}</JobNote>
        ),
        // Replacements are per card, so there's no list to preview: the deck is the way in.
        replace: <JobNote>Pick any card in the deck to see what else does its job, and what the swap costs.</JobNote>,
      }}
    />
  );
}
