"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Inbox, MonitorSmartphone, RotateCcw, Server, TriangleAlert } from "lucide-react";
import type { Result } from "@mtg/core/contract";
import { cn } from "cn";
import type { AdminErrorEvent, AdminErrorTicket, AdminErrorTicketPage } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_SHEET, TEXT_LINK, TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";
import { AdminBackLink } from "./back-link";

/** Tickets per page. "More tickets" asks for the next one. */
const PAGE_SIZE = 25;
/** Rows drawn while the first page loads: enough to fill a phone screen. */
const SKELETON_ROWS = 3;

type Filter = "open" | "all";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
];

const WHEN = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" });

const offline = { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't reach the server." } } as const;

async function getJson<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, init);
    return (await res.json()) as Result<T>;
  } catch {
    return offline;
  }
}

const fetchTickets = (filter: Filter, offset: number) =>
  getJson<AdminErrorTicketPage>(
    `/api/admin/errors?${new URLSearchParams({ open: filter === "open" ? "1" : "0", offset: String(offset), limit: String(PAGE_SIZE) })}`,
  );

const fetchEvents = (id: number) => getJson<AdminErrorEvent[]>(`/api/admin/errors/${id}`);

const patchTicket = (id: number, resolved: boolean) =>
  getJson<null>(`/api/admin/errors/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resolved }),
  });

/**
 * Error tickets for platform admins, most recently seen first. A ticket is one kind of failure; Details opens every
 * kept time it happened, with the stack, what the visitor saw, the request and the deployment. Resolving keeps the
 * ticket in place, marked, until the list reloads, so a slip can be undone where it happened.
 */
export function ErrorsView() {
  const router = useRouter();
  const [page, setPage] = useState<AdminErrorTicketPage | null>(null);
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
    void fetchTickets(nextFilter, nextOffset).then((body) => {
      if (id !== request.current) return;
      setBusy(false);
      if (!body.ok) {
        setProblem(body.error.message);
        return;
      }
      setProblem(null);
      setPage((prev) => (append && prev ? { tickets: [...prev.tickets, ...body.data.tickets], total: body.data.total } : body.data));
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

  async function setResolved(ticket: AdminErrorTicket, resolved: boolean) {
    setSaving(ticket.id);
    const body = await patchTicket(ticket.id, resolved);
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
            tickets: prev.tickets.map((t) => (t.id === ticket.id ? { ...t, resolvedAt } : t)),
            // The Open count follows the change at once; All counts every ticket either way.
            total: filter === "open" ? prev.total + (resolved ? -1 : 1) : prev.total,
          }
        : prev,
    );
    router.refresh();
  }

  const tickets = page?.tickets ?? [];
  const more = page !== null && tickets.length < page.total;

  return (
    <>
      {/* One sheet for the heading and filters, one for the tickets: wood between them, no tiles on the paper. */}
      <div className={PAGE_SHEET}>
        <AdminBackLink />
        <h1 className="font-heading text-2xl leading-none font-semibold tracking-tight sm:text-3xl">Error tickets</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Every failure the site hit, on the server or in a visitor&apos;s browser, one ticket per kind. Accounts show by id, never by
          email. A browser&apos;s report says what that browser claimed: treat it as a lead, not proof.
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
                <Skeleton className="h-28 w-full" />
              </li>
            ))}
          </ul>
        )}

        {page !== null && tickets.length === 0 && (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Inbox aria-hidden className="size-4" />
            {filter === "open" ? "No open tickets." : "No tickets yet."}
          </p>
        )}

        {tickets.length > 0 && (
          <ul aria-label="Tickets" className={cn("flex flex-col divide-y divide-seam transition-opacity", busy && "opacity-60")}>
            {tickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                saving={saving === ticket.id}
                onResolve={(resolved) => void setResolved(ticket, resolved)}
              />
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
            More tickets
          </Button>
        )}
      </div>
    </>
  );
}

function LevelLabel({ level }: { level: AdminErrorTicket["level"] }) {
  return level === "error" ? (
    <span className="flex items-center gap-1 font-semibold text-destructive">
      <CircleAlert aria-hidden className="size-3.5" />
      Error
    </span>
  ) : (
    <span className="flex items-center gap-1 font-semibold text-warning">
      <TriangleAlert aria-hidden className="size-3.5" />
      Warning
    </span>
  );
}

function SourceLabel({ source }: { source: AdminErrorTicket["source"] }) {
  const Icon = source === "server" ? Server : MonitorSmartphone;
  return (
    <span className="flex items-center gap-1">
      <Icon aria-hidden className="size-3.5" />
      {source === "server" ? "Server" : "Browser"}
    </span>
  );
}

function TicketRow({ ticket, saving, onResolve }: { ticket: AdminErrorTicket; saving: boolean; onResolve: (resolved: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AdminErrorEvent[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const detailsId = `ticket-${ticket.id}-events`;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || events !== null) return;
    const body = await fetchEvents(ticket.id);
    if (body.ok) {
      setEvents(body.data);
      setProblem(null);
    } else setProblem(body.error.message);
  }

  return (
    <li className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <LevelLabel level={ticket.level} />
        <SourceLabel source={ticket.source} />
        <span className="font-mono">#{ticket.id}</span>
        {ticket.resolvedAt && (
          <span className="flex items-center gap-1 font-semibold text-success">
            <CircleCheck aria-hidden className="size-3.5" />
            Resolved
          </span>
        )}
        {ticket.recurrenceOf !== null && (
          <span className="flex items-center gap-1 font-semibold text-warning">
            <RotateCcw aria-hidden className="size-3.5" />
            Back after #{ticket.recurrenceOf} was resolved
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold break-all">
          {ticket.area}
          {ticket.code && <span className="text-muted-foreground"> · {ticket.code}</span>}
        </p>
        <p className="text-sm break-words whitespace-pre-wrap">{ticket.message}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Seen</dt>
        <dd>
          <span className="font-mono">{ticket.occurrences.toLocaleString()}</span> {ticket.occurrences === 1 ? "time" : "times"}
          {ticket.accounts > 0 && (
            <>
              , by at least <span className="font-mono">{ticket.accounts}</span> signed-in {ticket.accounts === 1 ? "account" : "accounts"}
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">First</dt>
        <dd>
          <time dateTime={ticket.firstSeenAt}>{WHEN.format(new Date(ticket.firstSeenAt))}</time>
        </dd>
        <dt className="text-muted-foreground">Last</dt>
        <dd>
          <time dateTime={ticket.lastSeenAt}>{WHEN.format(new Date(ticket.lastSeenAt))}</time>
        </dd>
        {ticket.pagePath && (
          <>
            <dt className="text-muted-foreground">Page</dt>
            <dd className="min-w-0">
              <Link href={ticket.pagePath as Route} className={cn(TEXT_LINK, "break-all")}>
                {ticket.pagePath}
              </Link>
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-11 px-3"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => void toggle()}
        >
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
          Details
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          disabled={saving}
          onClick={() => onResolve(ticket.resolvedAt === null)}
        >
          {ticket.resolvedAt === null ? "Resolve" : "Reopen"}
        </Button>
      </div>

      {open && (
        <div id={detailsId} className="flex min-w-0 flex-col gap-4 border-t border-seam pt-3">
          {problem && <ErrorText>{problem}</ErrorText>}
          {events === null && !problem && <Skeleton className="h-24 w-full" />}
          {events?.length === 0 && <p className="text-sm text-muted-foreground">No events kept.</p>}
          {events && events.length > 0 && (
            <ol aria-label={`Times ticket ${ticket.id} happened, newest first`} className="flex flex-col divide-y divide-seam">
              {events.map((event) => (
                <EventDetail key={event.id} event={event} />
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

/** Scalar facts as a two-column list. Objects and arrays print as JSON, so nothing in the detail is ever hidden. */
function Facts({ label, facts }: { label: string; facts: unknown }) {
  if (typeof facts !== "object" || facts === null) return null;
  const entries = Object.entries(facts as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h3 className="text-xs font-semibold">{label}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 break-all">{typeof value === "string" ? value : JSON.stringify(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface ErrorShape {
  name?: string;
  message?: string;
  stack?: string;
  digest?: string;
  code?: string;
  details?: string;
  hint?: string;
  causes?: ErrorShape[];
}

/** An error and its causes. `repeats` is the message already shown above it, left out here so it reads once. */
function ErrorBlock({ error, label, repeats }: { error: ErrorShape; label: string; repeats?: string }) {
  const { stack, causes, message, ...rest } = error;
  const facts = message === repeats ? rest : { ...rest, message };
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <Facts label={label} facts={facts} />
      {stack && (
        // The stack scrolls inside its own box, so a long frame never widens the page.
        <pre className="max-h-64 overflow-auto border border-seam p-2 font-mono text-xs whitespace-pre">{stack}</pre>
      )}
      {causes?.map((cause, i) => (
        <ErrorBlock key={i} error={cause} label={`Caused by (${i + 1})`} />
      ))}
    </section>
  );
}

function EventDetail({ event }: { event: AdminErrorEvent }) {
  const { error, shown, context, request, deployment, ...rest } = event.detail;
  return (
    <li className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">When</dt>
        <dd>
          <time dateTime={event.occurredAt}>{WHEN.format(new Date(event.occurredAt))}</time>
        </dd>
        <dt className="text-muted-foreground">Account</dt>
        <dd className="min-w-0 break-all">{event.userId ?? "signed out"}</dd>
        {event.pagePath && (
          <>
            <dt className="text-muted-foreground">Page</dt>
            <dd className="min-w-0">
              <Link href={event.pagePath as Route} className={cn(TEXT_LINK, "break-all")}>
                {event.pagePath}
              </Link>
            </dd>
          </>
        )}
        {typeof shown === "string" && (
          <>
            <dt className="text-muted-foreground">They saw</dt>
            <dd>{shown}</dd>
          </>
        )}
      </dl>
      <p className="text-sm break-words whitespace-pre-wrap">{event.message}</p>
      {typeof error === "object" && error !== null && <ErrorBlock error={error as ErrorShape} label="Error" repeats={event.message} />}
      <Facts label="What the code was doing" facts={context} />
      <Facts label="Request" facts={request} />
      <Facts label="Deployment" facts={deployment} />
      <Facts label="Other" facts={rest} />
    </li>
  );
}
