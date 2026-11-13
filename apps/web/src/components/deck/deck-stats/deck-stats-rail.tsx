import type { ComponentProps } from "react";
import { cn } from "cn";
import { LevelBadge, ScoreAfter } from "./level";
import { DeckStatsPanel } from "./deck-stats-panel";

type PanelProps = ComponentProps<typeof DeckStatsPanel>;

/** Wide screens: always open beside the work, sticky under the deck bar, scrolling on its own. */
export function DeckStatsRail({ className, ...panel }: PanelProps & { className?: string }) {
  const { report, after } = panel;
  return (
    <aside
      aria-labelledby="deck-stats-rail-title"
      className={cn(
        "sticky top-[calc(var(--deck-bar-height,0px)+1rem)] flex max-h-[calc(100dvh-var(--deck-bar-height,0px)-2rem)] flex-col gap-4 overflow-y-auto overscroll-contain rounded-panel border border-seam bg-sleeve p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="deck-stats-rail-title" className="font-heading text-lg leading-none font-semibold">
          Deck stats
        </h2>
        <span className="flex shrink-0 items-center gap-2">
          <LevelBadge level={report.level} okCount={report.okCount} total={report.total} />
          {after && <ScoreAfter okCount={after.okCount} total={after.total} now={report.okCount} />}
        </span>
      </div>
      <DeckStatsPanel {...panel} />
    </aside>
  );
}
