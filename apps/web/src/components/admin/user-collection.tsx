"use client";

import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDataProvider, useRecordContext } from "react-admin";
import { Library, Search, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import {
  ADMIN_COLLECTION_PAGE,
  MAX_ADMIN_USER_IMPORTS,
  MAX_COLLECTION_SEARCH_CHARS,
  MIN_COLLECTION_SEARCH_CHARS,
  type AdminCollectionImport,
  type AdminCollectionItem,
  type AdminUser,
  type AdminUserCollection,
} from "@/lib/admin/types";
import { asOfSuffix, formatUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminDataProvider } from "./data-provider";
import { Pill } from "./pill";
import { ONE_LOOK } from "./user-decks";

/** An import commits within seconds of starting; one still open an hour later was abandoned by the player. */
const STALE_IMPORT_MS = 60 * 60 * 1000;
/** Each search writes an audit row, so the box waits for a pause in typing before it asks. */
const SEARCH_DEBOUNCE_MS = 400;
/** Placeholder lines while the totals or a page of results load. */
const LOADING_LINES = 3;

/** The app an import came from, as players know it. */
const SOURCE_APP_LABEL: Record<AdminCollectionImport["sourceApp"], string> = {
  manabox: "ManaBox",
  moxfield: "Moxfield",
  tcgplayer: "TCGplayer",
  generic_csv: "CSV",
  generic_json: "JSON",
  text: "Pasted text",
};

/** Nonfoil is the default and goes unsaid. */
const FINISH_LABEL: Record<AdminCollectionItem["finish"], string> = { nonfoil: "", foil: "Foil", etched: "Etched" };

const shortDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const isAbandoned = (item: AdminCollectionImport) =>
  item.status === "open" && Date.now() - new Date(item.createdAt).getTime() > STALE_IMPORT_MS;

/**
 * The account's collection on the user page's Collection tab: totals, import history, and a card-name search over the
 * entries. There is no full listing; a support question names a card.
 *
 * Mounted only while the tab is shown, so the totals are read (and audited) once the tab opens, and each search writes
 * its own audit row.
 */
export function UserCollection() {
  const record = useRecordContext<AdminUser>();
  const dataProvider = useDataProvider<AdminDataProvider>();
  const userId = record?.id === undefined ? undefined : String(record.id);
  const collection = useQuery({
    queryKey: ["admin", "user-collection", userId],
    queryFn: () => dataProvider.getUserCollection(String(userId)),
    enabled: userId !== undefined,
    ...ONE_LOOK,
  });

  if (collection.isError) return <ErrorText className="py-2">{collection.error.message}</ErrorText>;
  if (!collection.data || userId === undefined) {
    return (
      <div className="flex flex-col gap-3 py-2" role="status" aria-label="Loading the collection">
        {Array.from({ length: LOADING_LINES }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Totals collection={collection.data} />
      <Imports imports={collection.data.imports} />
      {collection.data.entries > 0 && <EntrySearch userId={userId} />}
    </div>
  );
}

function Totals({ collection }: { collection: AdminUserCollection }) {
  if (collection.entries === 0) {
    return (
      <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Library aria-hidden className="size-4" />
        No collection.
      </p>
    );
  }
  const facts: [string, string][] = [
    ["Entries", collection.entries.toLocaleString()],
    ["Cards", collection.distinctCards.toLocaleString()],
    ["Copies", collection.totalQuantity.toLocaleString()],
    ["Unpriced entries", collection.unpricedEntries.toLocaleString()],
  ];
  return (
    <section aria-label="Totals" className="flex flex-col gap-3">
      <p className="text-sm">
        Value <span className="font-mono">{formatUsd(collection.valueUsd)}</span>
        <span className="text-muted-foreground">{asOfSuffix(collection.pricesAsOf)}</span>
        {" · "}
        {collection.shared ? "Shared by link" : "Not shared"}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-base">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Imports({ imports }: { imports: AdminCollectionImport[] }) {
  return (
    <section aria-label="Imports" className="flex flex-col gap-1 border-t border-seam pt-4">
      <h3 className="text-sm font-semibold">Imports</h3>
      {imports.length === 0 ? (
        <p className="text-xs text-muted-foreground">No imports.</p>
      ) : (
        <>
          {imports.length === MAX_ADMIN_USER_IMPORTS && (
            <p className="text-xs text-muted-foreground">The newest {MAX_ADMIN_USER_IMPORTS}.</p>
          )}
          <ul className="flex flex-col divide-y divide-seam">
            {imports.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                <span className="text-sm font-semibold">{SOURCE_APP_LABEL[item.sourceApp]}</span>
                <ImportStatus item={item} />
                <span className="text-muted-foreground">{item.mode === "replace" ? "Replaced the collection" : "Merged in"}</span>
                <span className="font-mono">{item.rowsTotal.toLocaleString()} rows</span>
                <span className="text-muted-foreground">{shortDateTime(item.committedAt ?? item.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ImportStatus({ item }: { item: AdminCollectionImport }) {
  if (item.status === "committed") return <Pill tone="muted">Committed</Pill>;
  if (isAbandoned(item)) {
    return (
      <Pill tone="warning">
        <TriangleAlert aria-hidden className="size-3" />
        Never committed
      </Pill>
    );
  }
  return <Pill tone="ink">In progress</Pill>;
}

/** A card-name search over the entries, a page at a time. Nothing is listed until the search is long enough. */
function EntrySearch({ userId }: { userId: string }) {
  const dataProvider = useDataProvider<AdminDataProvider>();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const ready = search.length >= MIN_COLLECTION_SEARCH_CHARS;
  const results = useQuery({
    queryKey: ["admin", "user-collection-items", userId, search, offset],
    queryFn: () => dataProvider.searchUserCollection(userId, search, offset),
    enabled: ready,
    placeholderData: keepPreviousData,
    ...ONE_LOOK,
  });

  function changeText(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearch(value.trim());
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
  }

  const page = ready ? results.data : undefined;
  const rows = page?.rows ?? [];
  const last = offset + rows.length;

  return (
    <section aria-label="Find a card" className="flex flex-col gap-3 border-t border-seam pt-4">
      <h3 className="text-sm font-semibold">Find a card</h3>
      <div className="relative min-w-0 sm:max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Card name"
          placeholder="Card name"
          maxLength={MAX_COLLECTION_SEARCH_CHARS}
          value={text}
          onChange={(e) => changeText(e.target.value)}
          className="bg-sleeve pl-9 text-base sm:text-sm"
        />
      </div>

      {!ready && <p className="text-xs text-muted-foreground">Type at least {MIN_COLLECTION_SEARCH_CHARS} letters of a card name.</p>}
      {ready && results.isError && <ErrorText className="text-xs">{results.error.message}</ErrorText>}
      {ready && !page && results.isFetching && (
        <div className="flex flex-col gap-1.5" role="status" aria-label="Searching">
          {Array.from({ length: LOADING_LINES }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      )}
      {page && (
        <>
          <p aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
            {page.total === 0
              ? "No entry matches that."
              : `${(offset + 1).toLocaleString()}–${last.toLocaleString()} of ${page.total.toLocaleString()} ${page.total === 1 ? "entry" : "entries"}`}
          </p>
          {rows.length > 0 && (
            <ul className={cn("flex flex-col divide-y divide-seam text-xs transition-opacity", results.isPlaceholderData && "opacity-60")}>
              {rows.map((row, i) => (
                <EntryRow key={offset + i} row={row} />
              ))}
            </ul>
          )}
          {page.total > ADMIN_COLLECTION_PAGE && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={offset === 0 || results.isFetching}
                onClick={() => setOffset((was) => Math.max(0, was - ADMIN_COLLECTION_PAGE))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={last >= page.total || results.isFetching}
                onClick={() => setOffset((was) => was + ADMIN_COLLECTION_PAGE)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EntryRow({ row }: { row: AdminCollectionItem }) {
  const printing = row.setCode ? `${row.setCode.toUpperCase()} #${row.collectorNumber ?? "?"}` : "Any printing";
  const details = [printing, FINISH_LABEL[row.finish], row.condition.replaceAll("_", " "), row.lang.toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex min-w-0 items-baseline gap-2 py-1.5">
      <span className="w-8 shrink-0 text-right font-mono text-muted-foreground">{row.quantity}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{row.cardName}</span>
        <span className="truncate text-muted-foreground">{details}</span>
      </span>
    </li>
  );
}
