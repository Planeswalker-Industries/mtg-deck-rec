"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ChevronDown, ExternalLink, Layers, Search } from "lucide-react";
import type { Result } from "@mtg/core/contract";
import { cn } from "cn";
import type { AdminCrawledDeck, AdminCrawledDeckCard, AdminCrawledDeckPage, AdminCrawlSource } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/** Typing waits this long before asking again, so a word is one request rather than one per letter. */
const SEARCH_DEBOUNCE_MS = 350;
/** Decks per page. "More decks" asks for the next one. */
const PAGE_SIZE = 25;
/** How long the whole list takes to arrive, spread across its rows. Past this a stagger reads as lag, not motion. */
const STAGGER_TOTAL_S = 0.24;
/** Rows past this one appear together: a stagger only says "these arrived" for the few the eye can follow. */
const STAGGER_ROWS = 12;

type Sources = AdminCrawlSource[];

interface Loaded {
  sources: Sources;
  page: AdminCrawledDeckPage;
}

const SOURCES = ["archidekt", "moxfield"] as const;
type SourceFilter = (typeof SOURCES)[number] | "all";

/** The deck's page on the site it came from, so a row can be checked against the original in one click. */
function deckUrl(source: string, id: string): string | null {
  if (source === "archidekt") return `https://archidekt.com/decks/${id}`;
  if (source === "moxfield") return `https://moxfield.com/decks/${id}`;
  return null;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [365, "d"],
  ];
  let value = seconds;
  let unit = "s";
  for (const [size, next] of steps) {
    if (value < size) break;
    value /= size;
    unit = next;
  }
  return `${Math.floor(value)}${unit} ago`;
}

/** The lamp is the only thing that is lit, so a healthy source is gold and a stopped one wears its job colour. */
function stateTone(state: string | undefined, disabled: boolean): string {
  if (disabled) return "text-cut";
  if (state === "failed") return "text-cut";
  if (state === "succeeded") return "text-add";
  return "text-muted-foreground";
}

function SourceCard({ source, index }: { source: AdminCrawlSource; index: number }) {
  const reduce = useReducedMotion();
  const running = source.runningRunId !== null;
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : index * 0.06, duration: 0.3, ease: "easeOut" }}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-seam bg-sleeve p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-lg leading-none font-semibold capitalize">{source.source}</h2>
        <span className="flex items-center gap-1.5 text-xs font-bold">
          {running && (
            // A claim is held right now. The pulse is the one thing on this page that says "still happening".
            <motion.span
              aria-hidden
              animate={reduce ? {} : { opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              className="size-2 rounded-full bg-primary"
            />
          )}
          <span className={cn(stateTone(source.lastRun?.state, source.disabled))}>
            {source.disabled ? "disabled" : running ? "running" : (source.lastRun?.state ?? "never run")}
          </span>
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-heading text-3xl leading-none font-extrabold tabular-nums text-primary">
          {source.decks.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground">decks</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Last deck</dt>
        <dd className="text-right tabular-nums">{ago(source.lastFetchedAt)}</dd>
        <dt className="text-muted-foreground">Last run</dt>
        <dd className="text-right tabular-nums">{source.lastRun ? ago(source.lastRun.startedAt) : "never"}</dd>
        {source.lastRun && (
          <>
            <dt className="text-muted-foreground">Written</dt>
            <dd className="text-right tabular-nums">{source.lastRun.decksWritten}</dd>
          </>
        )}
      </dl>

      {/* A disabled source makes no requests until someone deliberately turns it back on, so say so loudly. */}
      {source.disabled && source.disabledReason && (
        <p className="flex items-start gap-1.5 rounded-lg border border-cut/40 bg-cut/5 px-2.5 py-2 text-xs text-cut">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{source.disabledReason}</span>
        </p>
      )}
      {!source.disabled && source.lastRun?.error && (
        <p className="min-w-0 rounded-lg border border-seam bg-muted/40 px-2.5 py-2 text-xs break-words text-muted-foreground">
          {source.lastRun.error}
        </p>
      )}
    </motion.li>
  );
}

function DeckRow({ deck, index }: { deck: AdminCrawledDeck; index: number }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<AdminCrawledDeckCard[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const url = deckUrl(deck.source, deck.sourceDeckId);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Fetched once, on the first open: most rows are never opened, and a hundred cards a deck across a page of
    // twenty-five is the difference between a fast list and a slow one.
    if (!next || cards !== null) return;
    try {
      const res = await fetch(`/api/admin/crawls/decks?deckId=${deck.id}`);
      const body = (await res.json()) as Result<AdminCrawledDeckCard[]>;
      if (body.ok) setCards(body.data);
      else setProblem(body.error.message);
    } catch {
      setProblem("Couldn't reach the server.");
    }
  }

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : Math.min(index, STAGGER_ROWS) * (STAGGER_TOTAL_S / STAGGER_ROWS), duration: 0.25 }}
      className="overflow-hidden rounded-xl border border-seam bg-sleeve"
    >
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-expanded={open}
          aria-label={open ? `Hide the cards in ${deck.sourceDeckId}` : `Show the cards in ${deck.sourceDeckId}`}
          className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="mt-0.5 text-muted-foreground"
          >
            <ChevronDown className="size-4" />
          </motion.span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">
              {deck.commanderNames.length > 0 ? deck.commanderNames.join(" and ") : "No commander resolved"}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{deck.sourceDeckId}</span>
              <span className={cn("tabular-nums", deck.deckSize !== 100 && "font-bold text-cut")}>{deck.deckSize} cards</span>
              <span className="tabular-nums">{deck.distinctCards} distinct</span>
              <span className="tabular-nums">fetched {ago(deck.fetchedAt)}</span>
            </span>
          </span>
        </button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${deck.sourceDeckId} on ${deck.source}`}
            className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ExternalLink aria-hidden className="size-4" />
          </a>
        )}
      </div>

      {/* The one animation that earns its place: the list grows out of the row rather than appearing over it. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="cards"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="overflow-hidden border-t border-seam"
          >
            <div className="p-3 sm:p-4">
              {problem && (
                <p role="alert" className="text-xs text-destructive">
                  {problem}
                </p>
              )}
              {!problem && cards === null && (
                <div className="flex flex-col gap-1.5" role="status" aria-label="Loading the cards">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              )}
              {cards !== null && (
                <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((card) => (
                    <li key={card.oracleId} className="flex min-w-0 items-baseline gap-2 py-0.5">
                      <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">{card.quantity}</span>
                      {/* An oracle id the catalog has never heard of is exactly what this page exists to show. */}
                      <span className={cn("min-w-0 truncate", card.name === null && "font-mono text-cut")}>
                        {card.name ?? card.oracleId}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/**
 * The crawled deck corpus, for platform admins.
 *
 * These are third-party decklists: aggregate-only everywhere else in the app, and reachable here only through the
 * `admin_*` functions, which check `auth.uid()` themselves. Nothing on this page is cached and the route is noindex.
 *
 * It exists because the crawl could not be seen. Its health was diagnosable only from `pg_stat_statements` and a
 * container log, and whether the adapter parsed what it fetched was not knowable at all without reading the cards.
 */
async function fetchCrawls(source: SourceFilter, search: string, offset: number): Promise<Result<Loaded>> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
  if (source !== "all") params.set("source", source);
  if (search.trim() !== "") params.set("search", search.trim());
  try {
    const res = await fetch(`/api/admin/crawls?${params}`);
    return (await res.json()) as Result<Loaded>;
  } catch {
    return { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't reach the server." } };
  }
}

export function CrawlsView() {
  const [data, setData] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  // True from the start: the mount effect fetches immediately, and setting this inside that effect would be a
  // synchronous setState in an effect body — a second render before the first has painted.
  const [busy, setBusy] = useState(true);
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Fetching is a plain function that returns what it got; applying it is the component's job. Split that way so the
   * mount effect can defer every setState behind a `.then` — a setState run synchronously in an effect body costs a
   * second render before the first has painted, and the lint rule that says so is right.
   */
  const apply = useCallback((body: Result<Loaded>, append: boolean) => {
    if (!body.ok) {
      setProblem(body.error.message);
      return;
    }
    setProblem(null);
    setData((prev) =>
      append && prev
        ? { sources: body.data.sources, page: { decks: [...prev.page.decks, ...body.data.page.decks], total: body.data.page.total } }
        : body.data,
    );
  }, []);

  const run = useCallback(
    (nextSource: SourceFilter, search: string, nextOffset: number, append: boolean) => {
      const id = ++request.current;
      // A counter, not an abort: a slower earlier answer must never overwrite a newer one.
      void fetchCrawls(nextSource, search, nextOffset).then((body) => {
        if (id !== request.current) return;
        apply(body, append);
        setBusy(false);
      });
    },
    [apply],
  );

  useEffect(() => {
    run("all", "", 0, false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run]);

  function changeSearch(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setOffset(0);
      setBusy(true);
      run(source, value, 0, false);
    }, SEARCH_DEBOUNCE_MS);
  }

  function changeSource(next: SourceFilter) {
    setSource(next);
    setOffset(0);
    setBusy(true);
    run(next, text, 0, false);
  }

  const decks = data?.page.decks ?? [];
  const more = data !== null && decks.length < data.page.total;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl leading-none font-extrabold tracking-tight sm:text-4xl">Deck crawls</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          What the crawlers have written into the corpus. These are other people&apos;s decklists: they feed play rates
          and nothing else, and this page is the only place in the app that shows them.
        </p>
      </div>

      {problem && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}

      {data === null ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-44 w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label="Crawl sources" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.sources.map((s, i) => (
            <SourceCard key={s.source} source={s} index={i} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Source" className="inline-flex rounded-lg bg-muted p-0.5">
            {(["all", ...SOURCES] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={source === s}
                onClick={() => changeSource(s)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  source === s ? "bg-sleeve text-foreground shadow-[0_1px_0_var(--seam)]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search decks"
              placeholder="Deck id or commander"
              value={text}
              onChange={(e) => changeSearch(e.target.value)}
              className="bg-sleeve pl-9 text-base sm:text-sm"
            />
          </div>
        </div>

        {data !== null && (
          <p aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
            {data.page.total.toLocaleString()} deck{data.page.total === 1 ? "" : "s"}
            {text.trim() !== "" && " matching"}
          </p>
        )}
      </div>

      {data !== null && decks.length === 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-seam bg-sleeve px-4 py-6 text-sm text-muted-foreground">
          <Layers aria-hidden className="size-4" />
          {text.trim() === "" ? "Nothing has been crawled yet." : "No deck matches that."}
        </p>
      )}

      {decks.length > 0 && (
        <ul aria-label="Crawled decks" className={cn("flex flex-col gap-2 transition-opacity", busy && "opacity-60")}>
          {decks.map((deck, i) => (
            <DeckRow key={deck.id} deck={deck} index={i} />
          ))}
        </ul>
      )}

      {more && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const next = offset + PAGE_SIZE;
            setOffset(next);
            setBusy(true);
            run(source, text, next, true);
          }}
        >
          More decks
        </Button>
      )}
    </div>
  );
}
