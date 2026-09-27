"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CollectionTotals, ResolvedCollectionRow, UnresolvedCollectionRow } from "@mtg/core/contract";
import { appendCsvPage, collectionLink } from "@mtg/core/parse";
import { importCollectionFromLinkAction } from "@/app/collection/actions";
import { FileDrop, IMPORT_TEXT_BOX, LoadedFile, lineCount } from "./file-drop";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import { getApis } from "@/lib/api/client";
import { COLLECTION_MAX_IMPORT_ROWS } from "@/lib/constants";
import {
  clearCollection,
  collectionTotals,
  MAX_UNMATCHED_KEPT,
  saveCollection,
  type UnmatchedLine,
} from "@/lib/collection-store";
import { notifyCollectionChanged, useCollectionSource } from "./use-collection-source";
import { useCollectionParser } from "./use-collection-parser";

/** The server accepts at most this many rows per call (it chunks matching internally under PostgREST's row cap). */
const ROWS_PER_CALL = 2_000;
const UNMATCHED_SHOWN = 50;

const PLACEHOLDER = `4 Sol Ring (C21) 263
1 Swords to Plowshares (STA) 10 *F*
2 Arcane Signet
…`;

const count = (n: number) => n.toLocaleString("en-US");

/** Data rows in downloaded CSV so far, for the progress bar: every line but the header. */
const csvDataRows = (csv: string) => Math.max(0, csv.split(/\r?\n/).filter((line) => line !== "").length - 1);

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" });

interface Unmatched {
  lines: UnmatchedLine[];
  count: number;
}

interface Problem {
  title: string;
  message: string;
}

const LINK = "font-bold text-primary underline-offset-4 hover:underline";

export function CollectionTool() {
  const { source, setSource } = useCollectionSource();
  const parse = useCollectionParser();
  const [text, setText] = useState("");
  /** The file the text came from, so the import can say what it is working on. */
  const [fileName, setFileName] = useState<string | null>(null);
  /** A file's text stays out of sight unless asked for: see `LoadedFile`. */
  const [fileTextShown, setFileTextShown] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  /** Lines that didn't match in the last import to the account, which doesn't keep them. */
  const [accountUnmatched, setAccountUnmatched] = useState<Unmatched | null>(null);
  const importRun = useRef(0);
  const signedIn = source.kind === "account" || (source.kind !== "loading" && source.signedIn);
  const hasCollection = source.kind === "browser" || source.kind === "account";

  const importFailed = (message: string) => setProblem({ title: "Couldn't import the collection", message });

  async function importText() {
    const id = ++importRun.current;
    const current = () => id === importRun.current;
    setProblem(null);
    // A lone link is fetched first; what comes back is CSV and takes the same path as an uploaded file.
    let exported = text;
    if (collectionLink(text)) {
      const downloaded = await downloadFromLink(text.trim(), current);
      if (downloaded === null) return;
      exported = downloaded;
    }
    // Parsing a large export is slow enough to say so: the worker keeps the page responsive, not instant.
    setProgress({ label: "Reading the export", done: 0, total: 1 });
    const rows = await parse(exported);
    if (!current()) return;
    if (rows.length === 0) {
      setProgress(null);
      return importFailed(
        fileName === null
          ? 'No cards found. Paste one card per line, like "4 Sol Ring (C21) 263", or upload a CSV export.'
          : `No cards found in ${fileName}. It should be a collection export from ManaBox, Moxfield, Archidekt or TCGplayer.`,
      );
    }
    if (rows.length > COLLECTION_MAX_IMPORT_ROWS) {
      setProgress(null);
      return importFailed(`That's ${count(rows.length)} lines. Collections can have up to ${count(COLLECTION_MAX_IMPORT_ROWS)} lines for now.`);
    }

    const resolved: ResolvedCollectionRow[] = [];
    const unresolved: UnresolvedCollectionRow[] = [];
    let catalogEpoch = "";
    setProgress({ label: "Matching cards", done: 0, total: rows.length });
    for (let start = 0; start < rows.length; start += ROWS_PER_CALL) {
      const result = await getApis().actions.resolveCollectionRows({ rows: rows.slice(start, start + ROWS_PER_CALL) });
      if (!current()) return;
      if (!result.ok) {
        setProgress(null);
        return importFailed(result.error.message);
      }
      resolved.push(...result.data.resolved);
      unresolved.push(...result.data.unresolved);
      catalogEpoch = result.data.catalogEpoch;
      setProgress({ label: "Matching cards", done: Math.min(start + ROWS_PER_CALL, rows.length), total: rows.length });
    }
    if (resolved.length === 0) {
      setProgress(null);
      return importFailed("None of those lines matched a card, so nothing was imported. Check the card names and try again.");
    }

    const unmatched: Unmatched = {
      lines: unresolved.slice(0, MAX_UNMATCHED_KEPT).map((u) => ({ rowNo: u.rowNo, name: u.input.name ?? null, reason: u.reason })),
      count: unresolved.length,
    };
    const saved = signedIn ? await saveToAccount(resolved, unmatched, current) : await saveToBrowser(catalogEpoch, resolved, unmatched, current);
    if (!current()) return;
    setProgress(null);
    if (saved) {
      setText("");
      setFileName(null);
    }
  }

  /**
   * Downloads a shared collection page by page. Each call to the server fetches a few export pages and says which to
   * ask for next. Returns the CSV, or null after reporting why it couldn't (or when a newer import took over).
   */
  async function downloadFromLink(url: string, current: () => boolean): Promise<string | null> {
    let csv = "";
    let page: number | null = 1;
    setProgress({ label: "Downloading the collection", done: 0, total: 0 });
    while (page !== null) {
      const result = await importCollectionFromLinkAction({ url, page });
      if (!current()) return null;
      if (!result.ok) {
        setProgress(null);
        importFailed(result.error.message);
        return null;
      }
      csv = appendCsvPage(csv, result.data.csv);
      const done = csvDataRows(csv);
      setProgress({ label: "Downloading from Archidekt", done, total: Math.max(done, result.data.totalRows ?? done) });
      page = result.data.nextPage;
    }
    return csv;
  }

  /** Replaces the account's collection with the import. Returns whether it saved. */
  async function saveToAccount(rows: ResolvedCollectionRow[], unmatched: Unmatched, current: () => boolean): Promise<boolean> {
    // The import replaces the account's collection, so a browser copy still waiting to move there is out of date.
    await clearCollection();
    let importId: string | null = null;
    let totals: CollectionTotals | null = null;
    setProgress({ label: "Saving to your account", done: 0, total: rows.length });
    for (let start = 0; start < rows.length; start += ROWS_PER_CALL) {
      const result = await getApis().actions.saveCollectionBatch({
        importId,
        sourceApp: "text",
        mode: "replace",
        rows: rows.slice(start, start + ROWS_PER_CALL),
        final: start + ROWS_PER_CALL >= rows.length,
      });
      if (!current()) return false;
      if (!result.ok) {
        importFailed(result.error.message);
        notifyCollectionChanged();
        return false;
      }
      importId = result.data.importId;
      totals = result.data.totals;
      setProgress({ label: "Saving to your account", done: Math.min(start + ROWS_PER_CALL, rows.length), total: rows.length });
    }
    setAccountUnmatched(unmatched);
    setSource(totals ? { kind: "account", totals } : { kind: "none", signedIn: true });
    return true;
  }

  async function saveToBrowser(catalogEpoch: string, rows: ResolvedCollectionRow[], unmatched: Unmatched, current: () => boolean): Promise<boolean> {
    try {
      const stored = await saveCollection({ catalogEpoch, rows, unmatched: unmatched.lines, unmatchedCount: unmatched.count });
      if (!current()) return false;
      setSource({ kind: "browser", signedIn: false, collection: stored });
      return true;
    } catch {
      importFailed("This browser wouldn't save the collection. Private browsing can block storage; try a regular window.");
      return false;
    }
  }

  async function clear() {
    importRun.current++;
    setProgress(null);
    setProblem(null);
    setAccountUnmatched(null);
    if (source.kind === "account") {
      const result = await getApis().actions.deleteCollection();
      if (!result.ok) return setProblem({ title: "Couldn't clear the collection", message: result.error.message });
      setSource({ kind: "none", signedIn: true });
      return;
    }
    await clearCollection();
    setSource({ kind: "none", signedIn });
  }

  const importing = progress !== null;
  const textHidden = fileName !== null && !fileTextShown;
  // A large export is tens of thousands of lines, and the form re-renders on every progress tick.
  const fileLines = useMemo(() => (fileName === null ? 0 : lineCount(text)), [fileName, text]);
  const isLink = collectionLink(text) !== null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">Import your collection</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Upload or paste a collection export from ManaBox, Moxfield, Archidekt or TCGplayer, or paste a link to a public Archidekt collection, and the deck tool can suggest only cards you own.
          {source.kind !== "loading" &&
            (signedIn ? (
              " It's saved to your account."
            ) : (
              <>
                {" "}
                It stays in this browser for 7 days.{" "}
                <Link href="/sign-in?next=/collection/import" className={LINK}>
                  Sign in
                </Link>{" "}
                to save it to your account instead.
              </>
            ))}
        </p>
      </div>

      {source.kind === "browser" && (
        <CollectionSummary
          totals={collectionTotals(source.collection)}
          note={
            source.signedIn
              ? "Moving it to your account…"
              : `Imported ${day(source.collection.importedAt)}. Saved in this browser until ${day(source.collection.expiresAt)}.`
          }
          unmatched={{ lines: source.collection.unmatched, count: source.collection.unmatchedCount }}
          onClear={() => void clear()}
        />
      )}
      {source.kind === "account" && (
        <CollectionSummary
          totals={source.totals}
          note={`Saved to your account. Updated ${day(Date.parse(source.totals.updatedAt))}.`}
          unmatched={accountUnmatched}
          onClear={() => void clear()}
        />
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void importText();
        }}
      >
        <Label htmlFor={textHidden ? undefined : "collection-text"} className="font-bold">
          {hasCollection ? "Replace with a new export" : "Collection export"}
        </Label>
        {fileName !== null ? (
          <LoadedFile
            name={fileName}
            lines={fileLines}
            textShown={fileTextShown}
            onToggleText={() => setFileTextShown((shown) => !shown)}
            onRemove={() => {
              setText("");
              setFileName(null);
              setProblem(null);
            }}
            disabled={importing}
          />
        ) : (
          <FileDrop
            note=".csv or .txt from ManaBox, Moxfield, Archidekt or TCGplayer. It stays in your browser."
            disabled={importing}
            onFile={(contents, name) => {
              setProblem(null);
              setText(contents);
              setFileName(name);
              setFileTextShown(false);
            }}
          />
        )}
        {!textHidden && (
          <Textarea
            id="collection-text"
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
              // The last problem was about the last text; leaving it up makes the new text look wrong too.
              setProblem(null);
            }}
            placeholder={PLACEHOLDER}
            aria-describedby={fileName === null ? "collection-text-hint" : undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={importing}
            className={IMPORT_TEXT_BOX}
          />
        )}
        {fileName === null && (
          <p id="collection-text-hint" className="text-sm text-muted-foreground">
            Or paste a link to a public Archidekt collection, like https://archidekt.com/collection/v2/123456.
          </p>
        )}
        {progress && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <p className="text-sm font-bold tabular-nums">
              {/* Before a download says how large it is, there is nothing to count against. */}
              {progress.total > 0 ? `${progress.label}: ${count(progress.done)} of ${count(progress.total)}` : `${progress.label}…`}
            </p>
            <ProgressBar value={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0} label="Collection import" />
          </div>
        )}
        {problem && (
          <Alert variant="destructive">
            <AlertTitle>{problem.title}</AlertTitle>
            <AlertDescription>{problem.message}</AlertDescription>
          </Alert>
        )}
        <div>
          <Button type="submit" size="lg" disabled={!text.trim() || importing || source.kind === "loading"}>
            {importing ? "Importing…" : isLink ? "Import from link" : hasCollection ? "Replace collection" : "Import collection"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CollectionSummary({
  totals,
  note,
  unmatched,
  onClear,
}: {
  totals: Pick<CollectionTotals, "uniqueCards" | "totalQuantity">;
  note: string;
  unmatched: Unmatched | null;
  onClear: () => void;
}) {
  return (
    <section aria-labelledby="collection-summary" className="flex flex-col gap-4 rounded-lg border border-seam bg-sleeve p-4">
      <h2 id="collection-summary" className="sr-only">
        Saved collection
      </h2>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-muted-foreground">Different cards</dt>
          <dd className="font-heading text-3xl font-extrabold tabular-nums">{count(totals.uniqueCards)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Copies</dt>
          <dd className="font-heading text-3xl font-extrabold tabular-nums">{count(totals.totalQuantity)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{note}</p>
      {unmatched && unmatched.count > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-bold">
            {count(unmatched.count)} line{unmatched.count === 1 ? "" : "s"} didn&apos;t match a card
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
            {unmatched.lines.slice(0, UNMATCHED_SHOWN).map((line) => (
              <li key={line.rowNo}>
                Line {line.rowNo}: {line.name ?? "no card name"}
              </li>
            ))}
          </ul>
          {unmatched.count > UNMATCHED_SHOWN && (
            <p className="mt-1 text-muted-foreground">and {count(unmatched.count - UNMATCHED_SHOWN)} more</p>
          )}
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href="/collection" className={buttonVariants({ size: "lg" })}>
          Browse your collection
        </Link>
        <Link href="/deck" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Use it in the deck tool
        </Link>
        <Button type="button" size="lg" variant="outline" onClick={onClear}>
          Clear collection
        </Button>
      </div>
    </section>
  );
}
