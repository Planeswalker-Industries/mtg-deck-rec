"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Title, useDataProvider } from "react-admin";
import { Link as RouterLink } from "react-router-dom";
import { Activity, Ban, ChevronRight } from "lucide-react";
import type { AdminCrawlSource, AdminSiteStats, AdminWindowedCount } from "@/lib/admin/types";
import { ErrorText } from "@/components/ui/error-text";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, crawlProgressLine } from "./crawls-view";
import type { AdminDataProvider } from "./data-provider";
import { Pill } from "./pill";
import { LatestRuns } from "./sync-runs";

/** Placeholder tiles while the site numbers load: one per stat. */
const SITE_STAT_COUNT = 6;
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
      <Stat label="Collections" value={stats.collections} />
      <Stat label="Imports this week" value={stats.importsLast7d} />
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
            <CrawlSourceRow key={source.source} source={source} />
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
function CrawlSourceRow({ source }: { source: AdminCrawlSource }) {
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
    </li>
  );
}
