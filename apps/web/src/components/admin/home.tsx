"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Title, useDataProvider } from "react-admin";
import { Link as RouterLink } from "react-router-dom";
import { Activity, Ban, ChevronRight } from "lucide-react";
import { crawlDuty, crawlDutySource, nextWorkerRuns, type NextRun, type WorkerDuty } from "@mtg/core/worker";
import type { AdminCrawlSource, AdminSiteStats, AdminWindowedCount, AdminWorkerSchedule } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, crawlProgressLine } from "./crawls-view";
import type { AdminDataProvider } from "./data-provider";
import { Pill } from "./pill";
import { LatestRuns } from "./sync-runs";

/** Placeholder tiles while the site numbers load: one per stat. */
const SITE_STAT_COUNT = 6;
/** Placeholder rows while the worker's schedule loads: one per duty with a Run now. */
const WORKER_DUTY_COUNT = 5;

/** The worker's duties an admin can run now, named as the job list above them names their runs. */
const DUTY_LABEL: Record<WorkerDuty, string> = {
  collate: "Corpus collation",
  baseline: "Nightly baseline",
  scores: "Commander scores",
  global_pairs: "Card pairs (all decks)",
  edhrec: "EDHREC import",
};
const DUTY_ORDER: readonly WorkerDuty[] = ["collate", "baseline", "scores", "global_pairs", "edhrec"];

/**
 * How long Run now stays off after an ask. The worker takes an ask within seconds and its run then shows above; a
 * minute keeps a second tap (or a second admin's stale page) from queueing the same duty again behind it.
 */
const RUN_NOW_COOLDOWN_MS = 60_000;

/** What each run costs, said in the confirmation before the ask is sent. */
const DUTY_COST: Record<WorkerDuty, string> = {
  collate:
    "Collates new crawled decks into the corpus, then refreshes the commander stats, substitutes, roles, combos and card pairs that changed. Minutes.",
  baseline: "Rebuilds every card's baseline, then re-scores every commander. Several minutes.",
  scores: "Re-scores every commander with the current settings. Several minutes.",
  global_pairs: "Recounts the card pairs over every deck in the corpus. Runs beside the other duties, for a while.",
  edhrec: "Fetches every commander page from EDHREC again, at one request a second. Hours.",
};
const CRAWL_COST =
  "Starts a crawl run now, at one request a second, for up to six hours. A deploy to main stops it, and the day's scheduled run counts this one as the day's.";

const NEXT_AT = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const SCHEDULE_QUERY = ["admin", "worker-schedule"] as const;
/** Placeholder rows while the crawl sources load: archidekt and moxfield. */
const CRAWL_SOURCE_COUNT = 2;

/** Every stat and crawl row is a whole-item link, at least 44 px tall on a phone. */
const ITEM_LINK =
  "group flex min-h-11 min-w-0 flex-col gap-0.5 rounded-md py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
/** A crawl source's row: the parent grid's two columns (name, then state and details), the whole row one link. */
const CRAWL_ROW_LINK =
  "group col-span-2 grid min-h-11 grid-cols-subgrid gap-y-0.5 rounded-md py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const SECTION = "flex min-w-0 flex-col gap-3 border-t border-seam pt-4";
const SECTION_HEADING = "font-heading text-lg leading-none font-semibold";

/**
 * The admin area's front page: the site's numbers, the worker's jobs and the crawler, each linking on to the screen
 * with the detail. Everything is read live on every visit; the app bar's refresh button reads it all again.
 */
export function AdminHome() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Title title="Home" />
      <SiteSection />
      {/* Each job's newest run, as the Sync runs screen shows it above the history. */}
      <section aria-labelledby="home-worker" className={SECTION}>
        <h2 id="home-worker" className={SECTION_HEADING}>
          Worker
        </h2>
        <LatestRuns />
        <WorkerSchedule />
      </section>
      <CrawlerSection />
    </div>
  );
}

const plusLine = (count: AdminWindowedCount) => `+${count.last24h.toLocaleString()} today · +${count.last7d.toLocaleString()} this week`;

function SiteSection() {
  const dataProvider = useDataProvider<AdminDataProvider>();
  const stats = useQuery({ queryKey: ["admin", "site-stats"], queryFn: () => dataProvider.getSiteStats() });

  return (
    <section aria-labelledby="home-site" className="flex min-w-0 flex-col gap-3">
      <h2 id="home-site" className={SECTION_HEADING}>
        Site
      </h2>
      {stats.isError && <ErrorText>{stats.error.message}</ErrorText>}
      {stats.isPending && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" role="status" aria-label="Loading the site numbers">
          {Array.from({ length: SITE_STAT_COUNT }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}
      {stats.data && <SiteStats stats={stats.data} />}
    </section>
  );
}

function SiteStats({ stats }: { stats: AdminSiteStats }) {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
      <Stat label="Users" value={stats.users.total} detail={plusLine(stats.users)} to={{ app: "/users" }} />
      <Stat
        label="Decks saved"
        value={stats.decks.total}
        detail={`${stats.decks.public.toLocaleString()} public · ${plusLine(stats.decks)}`}
      />
      <Stat
        label="Journeys started"
        value={stats.journeys.total}
        detail={`${stats.journeys.paste.toLocaleString()} pasted · ${stats.journeys.build.toLocaleString()} built · ${plusLine(stats.journeys)}`}
      />
      <Stat label="Collections" value={stats.collections} detail={`${stats.importsLast7d.toLocaleString()} imports this week`} />
      <Stat label="Open reports" value={stats.openReports} to={{ site: "/admin/reports" }} />
      <Stat label="Open errors" value={stats.openErrors} to={{ site: "/admin/errors" }} />
    </ul>
  );
}

/**
 * Where a stat leads: a screen of the React Admin app (a react-router path under its /admin basename) or one of the
 * site's own admin pages, which Next routes.
 */
type StatTarget = { app: "/users" } | { site: "/admin/reports" | "/admin/errors" };

function Stat({ label, value, detail, to }: { label: string; value: number; detail?: string; to?: StatTarget }) {
  const body = (
    <>
      <span className={to ? "flex items-center gap-0.5 text-sm font-semibold text-primary" : "text-sm text-muted-foreground"}>
        {label}
        {to && <ChevronRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />}
      </span>
      <span className="font-mono text-2xl leading-tight text-foreground">{value.toLocaleString()}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </>
  );
  if (!to) return <li className="flex min-w-0 flex-col gap-0.5 py-2">{body}</li>;
  return (
    <li className="min-w-0">
      {"app" in to ? (
        <RouterLink to={to.app} className={ITEM_LINK}>
          {body}
        </RouterLink>
      ) : (
        <Link href={to.site} className={ITEM_LINK}>
          {body}
        </Link>
      )}
    </li>
  );
}

function CrawlerSection() {
  const dataProvider = useDataProvider<AdminDataProvider>();
  const sources = useQuery({ queryKey: ["admin", "crawl-sources"], queryFn: () => dataProvider.getCrawlSources() });
  const schedule = useQuery({ queryKey: SCHEDULE_QUERY, queryFn: () => dataProvider.getWorkerSchedule() });
  // As of the read, not the render: the app bar's refresh reads the schedule again and moves "now" with it.
  const next = schedule.data ? nextWorkerRuns(schedule.data, schedule.dataUpdatedAt).crawls : null;

  return (
    <section aria-labelledby="home-crawler" className={SECTION}>
      <h2 id="home-crawler" className={SECTION_HEADING}>
        Crawler
      </h2>
      {sources.isError && <ErrorText>{sources.error.message}</ErrorText>}
      {sources.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading the crawl sources">
          {Array.from({ length: CRAWL_SOURCE_COUNT }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}
      {sources.data && (
        // One grid for every source, so the state pills and the lines under them start at the same edge.
        <ul className="grid grid-cols-[auto_1fr] gap-x-3">
          {sources.data.map((source) => (
            <CrawlSourceRow
              key={source.source}
              source={source}
              next={next?.[source.source] ?? null}
              waitingSince={waitingSince(schedule.data, crawlDuty(source.source))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CrawlState({ source, running }: { source: AdminCrawlSource; running: boolean }): ReactNode {
  if (source.disabled) {
    return (
      <Pill tone="cut">
        <Ban aria-hidden size={12} />
        Disabled
      </Pill>
    );
  }
  if (running) {
    return (
      <Pill tone="ink">
        <Activity aria-hidden size={12} />
        Running
      </Pill>
    );
  }
  return <Pill tone="muted">Idle</Pill>;
}

/** One source: its state, and either the live run's progress or how its last run ended. */
function CrawlSourceRow({ source, next, waitingSince }: { source: AdminCrawlSource; next: NextRun | null; waitingSince: string | null }) {
  const running = source.runningRunId !== null;
  const last = source.lastRun;
  // The overview's last run is the newest row; while a claim is held that is the run doing the work.
  const live = running && last?.id === source.runningRunId ? last : null;

  return (
    <li className="col-span-2 grid grid-cols-subgrid border-t border-seam first:border-t-0">
      <Link href="/admin/crawls" className={CRAWL_ROW_LINK}>
        <span className="flex items-center gap-0.5 self-center text-sm font-semibold text-primary capitalize">
          {source.source}
          <ChevronRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
        <span className="self-center justify-self-start">
          <CrawlState source={source} running={running} />
        </span>
        {live && <span className="col-start-2 text-sm text-foreground">{crawlProgressLine(live)}</span>}
        {!live && last && (
          <span className="col-start-2 text-sm text-foreground">
            Last run {last.state}
            {last.finishedAt ? ` · finished ${ago(last.finishedAt)}` : ` · started ${ago(last.startedAt)}`}
            {` · ${last.decksWritten.toLocaleString()} decks written`}
          </span>
        )}
        {!live && !last && <span className="col-start-2 text-sm text-muted-foreground">Never run</span>}
        {source.disabled && source.disabledReason && (
          <span className="col-start-2 text-xs break-words text-muted-foreground">{source.disabledReason}</span>
        )}
        {!live && last?.error && <span className="col-start-2 text-xs break-words text-muted-foreground">{last.error}</span>}
      </Link>
      {/* Outside the row's link: a button can't sit inside one. A running or switched-off source has nothing to start. */}
      {!source.disabled && !running && next && (
        <div className="col-start-2 pb-2">
          <RunNow duty={crawlDuty(source.source)} label={`${source.source} crawl`} next={next} waitingSince={waitingSince} />
        </div>
      )}
    </li>
  );
}

/** When the duty's run-now ask was made, while the worker hasn't taken it yet; null when nothing waits. */
function waitingSince(schedule: AdminWorkerSchedule | undefined, duty: string): string | null {
  return schedule?.waiting.find((ask) => ask.duty === duty)?.requestedAt ?? null;
}

function nextRunText(next: NextRun): string {
  switch (next.kind) {
    case "at":
      return `Next ${NEXT_AT.format(new Date(next.at))}`;
    case "due":
      return "Due now";
    case "every":
      return `Every ${next.minutes} min`;
    case "onChange":
      return "When the scoring settings change";
    case "off":
      return "Not scheduled";
  }
}

/**
 * The worker's own duties: when each runs next on its own, and a button to run it now. The worker takes an ask on its
 * next pass, a few seconds away; the run then shows in the job list above.
 */
function WorkerSchedule() {
  const dataProvider = useDataProvider<AdminDataProvider>();
  const schedule = useQuery({ queryKey: SCHEDULE_QUERY, queryFn: () => dataProvider.getWorkerSchedule() });
  // As of the read, not the render: the app bar's refresh reads the schedule again and moves "now" with it.
  const next = schedule.data ? nextWorkerRuns(schedule.data, schedule.dataUpdatedAt).duties : null;

  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-seam pt-3">
      <h3 className="text-sm font-semibold">Schedule</h3>
      {schedule.isError && <ErrorText>{schedule.error.message}</ErrorText>}
      {schedule.isPending && (
        <div className="flex flex-col gap-2" role="status" aria-label="Loading the worker's schedule">
          {Array.from({ length: WORKER_DUTY_COUNT }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}
      {schedule.data && next && (
        <ul className="flex flex-col divide-y divide-seam">
          {DUTY_ORDER.map((duty) => (
            <li key={duty} className="flex min-w-0 flex-col gap-1 py-2">
              <span className="text-sm font-semibold">{DUTY_LABEL[duty]}</span>
              <RunNow duty={duty} label={DUTY_LABEL[duty]} next={next[duty]} waitingSince={waitingSince(schedule.data, duty)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A duty's next run, or the ask still waiting for the worker, beside the button that asks for a run now. The button
 * asks for a confirmation first, then stays off while the ask waits and for a minute after it was sent.
 */
function RunNow({ duty, label, next, waitingSince }: { duty: string; label: string; next: NextRun; waitingSince: string | null }) {
  const dataProvider = useDataProvider<AdminDataProvider>();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const ask = useMutation({
    mutationFn: () => dataProvider.requestWorkerRun(duty),
    onSuccess: () => {
      setCoolingDown(true);
      return queryClient.invalidateQueries({ queryKey: SCHEDULE_QUERY });
    },
  });

  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setCoolingDown(false), RUN_NOW_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);

  const waiting = waitingSince !== null;
  const off = waiting || coolingDown || ask.isPending;
  const crawlSource = crawlDutySource(duty);
  const cost = crawlSource === null ? DUTY_COST[duty as WorkerDuty] : CRAWL_COST;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-muted-foreground">
          {waiting ? `Asked ${ago(waitingSince)}, waiting for the worker` : nextRunText(next)}
        </span>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4 sm:h-9"
          disabled={off}
          onClick={() => setConfirming(true)}
          aria-label={`Run ${label} now`}
        >
          {waiting || coolingDown ? "Asked" : "Run now"}
        </Button>
      </div>
      {ask.isError && <ErrorText className="text-xs">{ask.error.message}</ErrorText>}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">Run {label} now?</DialogTitle>
            <DialogDescription>{cost}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={off}
              onClick={() => {
                setConfirming(false);
                ask.mutate();
              }}
            >
              Run now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
