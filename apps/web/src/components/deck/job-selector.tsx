"use client";

import { ChevronLeft, ChevronRight, Plus, Repeat2, Scissors } from "lucide-react";
import { cn } from "cn";

/** The three jobs the tool does. `null` is the deck itself, which is where the workspace starts. */
export type Job = "cut" | "add" | "replace";

export const JOBS: { value: Job; name: string; blurb: string; Icon: typeof Scissors; tone: string; ring: string }[] = [
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

export const jobFor = (job: Job) => JOBS.find((j) => j.value === job);

/**
 * Picks which job to look at.
 *
 * On a phone it's a drill-down: choosing a job replaces the list with a Back control, so one thing shows at a time.
 * In the wide layout the same three buttons are the rail and stay put, because there's room for the rail and the job
 * side by side, and marks which one the middle column is showing.
 *
 * The two states are CSS rather than a media query so the server and the browser render the same markup; they never
 * show at once, and the Back control exists only in the collapsed one.
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
  const open = selected === null ? undefined : jobFor(selected);

  return (
    <>
      {open && (
        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center gap-1 rounded-md py-2 pr-3 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ChevronLeft aria-hidden className="size-4" />
            Back
          </button>
          <span className={cn("flex items-center gap-2 font-heading text-xl leading-none font-semibold", open.tone)}>
            <open.Icon aria-hidden className="size-5" strokeWidth={2.5} />
            {open.name}
          </span>
        </div>
      )}

      <ul
        aria-label="What to look at"
        className={cn("grid gap-2 sm:grid-cols-3 lg:grid-cols-1", selected === null ? "grid" : "hidden lg:grid")}
      >
        {JOBS.map(({ value, name, blurb, Icon, tone, ring }) => {
          const showing = value === selected;
          return (
            <li key={value}>
              <button
                type="button"
                aria-current={showing ? "true" : undefined}
                // Picking the job already showing goes back to the deck, which is the only way back in the rail.
                onClick={() => onSelect(showing ? null : value)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  ring,
                  showing ? "bg-sleeve" : "bg-sleeve/60",
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
                <ChevronRight
                  aria-hidden
                  className={cn("size-4 shrink-0 transition-transform", showing ? "rotate-90 text-foreground" : "text-muted-foreground")}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
