"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ResolvedCollectionRow, UnresolvedCollectionRow } from "@mtg/core/contract";
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
  type StoredCollection,
} from "@/lib/collection-store";
import { useStoredCollection } from "./use-stored-collection";

/** The server matches at most this many rows per call. */
const ROWS_PER_CALL = 2_000;
const MAX_ROWS = 50_000;
const UNMATCHED_SHOWN = 50;

const PLACEHOLDER = `4 Sol Ring (C21) 263
1 Swords to Plowshares (STA) 10 *F*
2 Arcane Signet
…`;

const count = (n: number) => n.toLocaleString("en-US");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" });

export function CollectionTool() {
  const { state, replace } = useStoredCollection();
  const [text, setText] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importRun = useRef(0);
  const collection = state.status === "ready" ? state.collection : null;

  async function importText() {
    const id = ++importRun.current;
    setError(null);
    const rows = parseCollectionText(text);
    if (rows.length === 0) {
      setError('No cards found. Paste one card per line, like "4 Sol Ring (C21) 263".');
      return;
    }
    if (rows.length > MAX_ROWS) {
      setError(`That's ${count(rows.length)} lines. Collections can have up to ${count(MAX_ROWS)} lines for now.`);
      return;
    }

    const resolved: ResolvedCollectionRow[] = [];
    const unresolved: UnresolvedCollectionRow[] = [];
    let catalogEpoch = "";
    setProgress({ done: 0, total: rows.length });
    for (let start = 0; start < rows.length; start += ROWS_PER_CALL) {
      const result = await getApis().actions.resolveCollectionRows({ rows: rows.slice(start, start + ROWS_PER_CALL) });
      if (id !== importRun.current) return;
      if (!result.ok) {
        setProgress(null);
        setError(result.error.message);
        return;
      }
      resolved.push(...result.data.resolved);
      unresolved.push(...result.data.unresolved);
      catalogEpoch = result.data.catalogEpoch;
      setProgress({ done: Math.min(start + ROWS_PER_CALL, rows.length), total: rows.length });
    }

    try {
      const stored = await saveCollection({
        catalogEpoch,
        rows: resolved,
        unmatched: unresolved.slice(0, MAX_UNMATCHED_KEPT).map((u) => ({ rowNo: u.rowNo, name: u.input.name ?? null, reason: u.reason })),
        unmatchedCount: unresolved.length,
      });
      if (id !== importRun.current) return;
      replace(stored);
      setText("");
    } catch {
      setError("This browser wouldn't save the collection. Private browsing can block storage; try a regular window.");
    } finally {
      if (id === importRun.current) setProgress(null);
    }
  }

  async function clear() {
    importRun.current++;
    await clearCollection();
    replace(null);
    setProgress(null);
    setError(null);
  }

  const importing = progress !== null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">My collection</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Paste a collection export from ManaBox, Moxfield, Archidekt or TCGplayer. It stays in this browser for 7 days, and the deck
          tool can then suggest only cards you own.
        </p>
      </div>

      {collection && <CollectionSummary collection={collection} onClear={() => void clear()} />}

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void importText();
        }}
      >
        <Label htmlFor="collection-text" className="font-bold">
          {collection ? "Replace with a new export" : "Collection export"}
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
              Matching cards: {count(progress.done)} of {count(progress.total)} lines
            </p>
            <ProgressBar value={Math.round((progress.done / progress.total) * 100)} label="Collection import" />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t import the collection</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div>
          <Button type="submit" size="lg" disabled={!text.trim() || importing}>
            {importing ? "Importing…" : collection ? "Replace collection" : "Import collection"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CollectionSummary({ collection, onClear }: { collection: StoredCollection; onClear: () => void }) {
  const { uniqueCards, totalQuantity } = collectionTotals(collection);
  return (
    <section aria-labelledby="collection-summary" className="flex flex-col gap-4 rounded-lg border border-seam bg-sleeve p-4">
      <h2 id="collection-summary" className="sr-only">
        Saved collection
      </h2>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-muted-foreground">Different cards</dt>
          <dd className="font-heading text-3xl font-extrabold tabular-nums">{count(uniqueCards)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Copies</dt>
          <dd className="font-heading text-3xl font-extrabold tabular-nums">{count(totalQuantity)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Imported {day(collection.importedAt)}. Saved in this browser until {day(collection.expiresAt)}.
      </p>
      {collection.unmatchedCount > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-bold">
            {count(collection.unmatchedCount)} line{collection.unmatchedCount === 1 ? "" : "s"} didn&apos;t match a card
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
            {collection.unmatched.slice(0, UNMATCHED_SHOWN).map((line) => (
              <li key={line.rowNo}>
                Line {line.rowNo}: {line.name ?? "no card name"}
              </li>
            ))}
          </ul>
          {collection.unmatchedCount > UNMATCHED_SHOWN && (
            <p className="mt-1 text-muted-foreground">and {count(collection.unmatchedCount - UNMATCHED_SHOWN)} more</p>
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
