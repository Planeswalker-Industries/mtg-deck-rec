"use client";

import { ChevronLeft, ChevronRight, Plus, Repeat2, Scissors } from "lucide-react";
import { cn } from "cn";

/** The three jobs the tool does. `null` is the deck itself, which is where the workspace starts. */
export type Job = "cut" | "add" | "replace";

const JOBS: { value: Job; name: string; blurb: string; Icon: typeof Scissors; tone: string; ring: string }[] = [
  { value: "cut", name: "Cut", blurb: "Weak links", Icon: Scissors, tone: "text-cut", ring: "border-cut/40 hover:border-cut/70" },
  { value: "add", name: "Add", blurb: "Missing pieces", Icon: Plus, tone: "text-add", ring: "border-add/40 hover:border-add/70" },
  {
    value: "replace",
    name: "Replace",
    blurb: "Better ways to do the job",
    Icon: Repeat2,
    tone: "text-replace",
    ring: "border-replace/40 hover:border-replace/70",
  },
];

/**
 * Picks which job to look at. Choosing one is a drill-down rather than a tab: the selector collapses to a Back
 * control, so a phone shows one thing at a time instead of a row of tabs competing with the deck.
 */
export function JobSelector({
  selected,
  onSelect,
  counts,
}: {
  selected: Job | null;
  onSelect: (job: Job | null) => void;
  /** Suggestions found per job, shown on the buttons so the deck's state is legible before drilling in. */
  counts: Partial<Record<Job, number>>;
}) {
  if (selected !== null) {
    const job = JOBS.find((j) => j.value === selected);
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex items-center gap-1 rounded-md py-2 pr-3 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Back
        </button>
        {job && (
          <span className={cn("flex items-center gap-2 font-heading text-xl leading-none font-semibold", job.tone)}>
            <job.Icon aria-hidden className="size-5" strokeWidth={2.5} />
            {job.name}
          </span>
        )}
      </div>
    );
  }

  return (
    <ul aria-label="What to look at" className="grid gap-2 sm:grid-cols-3">
      {JOBS.map(({ value, name, blurb, Icon, tone, ring }) => (
        <li key={value}>
          <button
            type="button"
            onClick={() => onSelect(value)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border bg-sleeve/60 p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              ring,
            )}
          >
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border border-current/40", tone)}>
              <Icon aria-hidden className="size-4" strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block font-heading text-lg leading-none font-semibold", tone)}>{name}</span>
              <span className="mt-1 block truncate text-sm text-muted-foreground">{blurb}</span>
            </span>
            {counts[value] !== undefined && (
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{counts[value]}</span>
            )}
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}
