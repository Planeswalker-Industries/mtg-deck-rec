"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Inbox } from "lucide-react";
import type { Result } from "@mtg/core/contract";
import { cn } from "cn";
import type { AdminFeedbackReport, AdminFeedbackReportPage } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SHEET, TEXT_LINK, TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";
import { AdminBackLink } from "./back-link";

/** Reports per page. "More reports" asks for the next one. */
const PAGE_SIZE = 25;
/** Rows drawn while the first page loads: enough to fill a phone screen. */
const SKELETON_ROWS = 3;

type Filter = "open" | "all";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
];

const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

const offline = { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't reach the server." } } as const;

async function fetchReports(filter: Filter, offset: number): Promise<Result<AdminFeedbackReportPage>> {
  const params = new URLSearchParams({ open: filter === "open" ? "1" : "0", offset: String(offset), limit: String(PAGE_SIZE) });
  try {
    const res = await fetch(`/api/admin/reports?${params}`);
    return (await res.json()) as Result<AdminFeedbackReportPage>;
  } catch {
    return offline;
  }
}

async function patchReport(id: number, resolved: boolean): Promise<Result<null>> {
  try {
    const res = await fetch(`/api/admin/reports/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    return (await res.json()) as Result<null>;
  } catch {
    return offline;
  }
}

/**
 * Feedback reports for platform admins (T077), newest first. Resolving a report keeps it in place, marked, until the
 * list reloads, so a slip can be undone where it happened; the header's count refreshes with it.
 */
export function ReportsView() {
  const router = useRouter();
  const [page, setPage] = useState<AdminFeedbackReportPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [offset, setOffset] = useState(0);
  // True from the start: the mount effect fetches straight away (see CrawlsView).
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const request = useRef(0);

  const run = useCallback((nextFilter: Filter, nextOffset: number, append: boolean) => {
    const id = ++request.current;
    // A counter, not an abort: a slower earlier answer must never overwrite a newer one.
    void fetchReports(nextFilter, nextOffset).then((body) => {
      if (id !== request.current) return;
      setBusy(false);
      if (!body.ok) {
        setProblem(body.error.message);
        return;
      }
      setProblem(null);
      setPage((prev) => (append && prev ? { reports: [...prev.reports, ...body.data.reports], total: body.data.total } : body.data));
    });
  }, []);

  useEffect(() => {
    run("open", 0, false);
  }, [run]);

  function changeFilter(next: Filter) {
    setFilter(next);
    setOffset(0);
    setBusy(true);
    run(next, 0, false);
  }

  async function setResolved(report: AdminFeedbackReport, resolved: boolean) {
    setSaving(report.id);
    const body = await patchReport(report.id, resolved);
    setSaving(null);
    if (!body.ok) {
      setProblem(body.error.message);
      return;
    }
    setProblem(null);
    const resolvedAt = resolved ? new Date().toISOString() : null;
    setPage((prev) =>
      prev
        ? {
            reports: prev.reports.map((r) => (r.id === report.id ? { ...r, resolvedAt } : r)),
            // The Open count follows the change at once; All counts every report either way.
            total: filter === "open" ? prev.total + (resolved ? -1 : 1) : prev.total,
          }
        : prev,
    );
    router.refresh();
  }

  const reports = page?.reports ?? [];
  const more = page !== null && reports.length < page.total;

  return (
    <>
      {/* One sheet for the heading and filters, one for the reports: wood between them, no tiles on the paper. */}
      <div className={PAGE_SHEET}>
        <AdminBackLink />
        <h1 className="font-heading text-2xl leading-none font-semibold tracking-tight sm:text-3xl">Feedback reports</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          What signed-in players sent from Send feedback and deck pages&apos; Report links. Senders stay anonymous here.
        </p>

        <div className="flex flex-wrap items-center gap-3 border-t border-seam pt-4">
          <div role="group" aria-label="Show" className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => changeFilter(f.value)}
                className={cn(
                  "min-h-11 rounded-md px-4 text-sm font-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  filter === f.value ? TOGGLE_ON : TOGGLE_OFF,
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          {page !== null && (
            <p aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
              {page.total.toLocaleString()} {filter === "open" ? "open" : "in all"}
            </p>
          )}
        </div>

        {problem && <ErrorText>{problem}</ErrorText>}
      </div>

      <div className={PAGE_SHEET}>
        {page === null && !problem && (
          <ul className="flex flex-col gap-4">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li key={i}>
                <Skeleton className="h-24 w-full" />
              </li>
            ))}
          </ul>
        )}

        {page !== null && reports.length === 0 && (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Inbox aria-hidden className="size-4" />
            {filter === "open" ? "No open reports." : "No reports yet."}
          </p>
        )}

        {reports.length > 0 && (
          <ul aria-label="Reports" className={cn("flex flex-col divide-y divide-seam transition-opacity", busy && "opacity-60")}>
            {reports.map((report) => (
              <li key={report.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <time dateTime={report.createdAt}>{WHEN.format(new Date(report.createdAt))}</time>
                  {report.resolvedAt && (
                    <span className="flex items-center gap-1 font-semibold text-success">
                      <CircleCheck aria-hidden className="size-3.5" />
                      Resolved
                    </span>
                  )}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{report.message}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={report.pagePath as Route} className={cn(TEXT_LINK, "min-w-0 text-sm break-all")}>
                    {report.pagePath}
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    disabled={saving === report.id}
                    onClick={() => void setResolved(report, report.resolvedAt === null)}
                  >
                    {report.resolvedAt === null ? "Resolve" : "Reopen"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {more && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className="self-start"
            onClick={() => {
              const next = offset + PAGE_SIZE;
              setOffset(next);
              setBusy(true);
              run(filter, next, true);
            }}
          >
            More reports
          </Button>
        )}
      </div>
    </>
  );
}
