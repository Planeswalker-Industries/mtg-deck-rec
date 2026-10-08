import type { ComponentProps } from "react";
import { cn } from "cn";
import { LevelBadge } from "./level";
import { DeckStatsPanel } from "./deck-stats-panel";

type PanelProps = ComponentProps<typeof DeckStatsPanel>;

/** Wide screens: always open beside the work, sticky under the deck bar, scrolling on its own. */
export function DeckStatsRail({ className, ...panel }: PanelProps & { className?: string }) {
  const { report } = panel;
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
        <LevelBadge level={report.level} okCount={report.okCount} total={report.total} />
      </div>
      <DeckStatsPanel {...panel} />
    </aside>
  );
}
