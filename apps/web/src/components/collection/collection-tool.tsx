"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { CollectionTotals, ResolvedCollectionRow, UnresolvedCollectionRow } from "@mtg/core/contract";
import { parseCollectionText } from "@mtg/core/parse";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import { getApis } from "@/lib/api/client";
import {
  clearCollection,
  collectionTotals,
  MAX_UNMATCHED_KEPT,
  saveCollection,
  type UnmatchedLine,
} from "@/lib/collection-store";
import { notifyCollectionChanged, useCollectionSource } from "./use-collection-source";

/** The server matches and saves at most this many rows per call. */
const ROWS_PER_CALL = 2_000;
const MAX_ROWS = 50_000;
const UNMATCHED_SHOWN = 50;

const PLACEHOLDER = `4 Sol Ring (C21) 263
1 Swords to Plowshares (STA) 10 *F*
2 Arcane Signet
…`;

const count = (n: number) => n.toLocaleString("en-US");
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
  const [text, setText] = useState("");
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
    const rows = parseCollectionText(text);
    if (rows.length === 0) return importFailed('No cards found. Paste one card per line, like "4 Sol Ring (C21) 263".');
    if (rows.length > MAX_ROWS) {
      return importFailed(`That's ${count(rows.length)} lines. Collections can have up to ${count(MAX_ROWS)} lines for now.`);
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
    if (saved) setText("");
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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">My collection</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Paste a collection export from ManaBox, Moxfield, Archidekt or TCGplayer, and the deck tool can suggest only cards you own.
          {source.kind !== "loading" &&
            (signedIn ? (
              " It's saved to your account."
            ) : (
              <>
                {" "}
                It stays in this browser for 7 days.{" "}
                <Link href="/sign-in?next=/collection" className={LINK}>
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
        <Label htmlFor="collection-text" className="font-bold">
          {hasCollection ? "Replace with a new export" : "Collection export"}
        </Label>
        <Textarea
          id="collection-text"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={importing}
          className="bg-sleeve text-base sm:text-sm"
        />
        {progress && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <p className="text-sm font-bold tabular-nums">
              {progress.label}: {count(progress.done)} of {count(progress.total)}
            </p>
            <ProgressBar value={Math.round((progress.done / progress.total) * 100)} label="Collection import" />
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
            {importing ? "Importing…" : hasCollection ? "Replace collection" : "Import collection"}
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
        <Link href="/deck" className={buttonVariants({ size: "lg" })}>
          Use it in the deck tool
        </Link>
        <Button type="button" size="lg" variant="outline" onClick={onClear}>
          Clear collection
        </Button>
      </div>
    </section>
  );
}
