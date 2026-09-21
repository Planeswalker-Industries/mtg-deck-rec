import type { ApiError } from "@mtg/core/contract";
import { appendCsvPage, ARCHIDEKT_EXPORT_FIELDS, ARCHIDEKT_EXPORT_PAGE_SIZE, archidektExportPage } from "@mtg/core/parse";
import { COLLECTION_MAX_IMPORT_ROWS } from "@/lib/constants";
import { fetchShareLink } from "./share-import";
import type { PublicClient } from "./supabase";

/**
 * Export pages fetched per call. Four pages is 10,000 rows in a few seconds, so a call stays well inside a serverless
 * function's time limit, and a 50,000-row collection is five calls against the `import` rate limit's ten a minute.
 */
export const ARCHIDEKT_PAGES_PER_CALL = 4;

/** Archidekt asks for requests at least a second apart; the worker's crawler keeps the same spacing. */
const ARCHIDEKT_REQUEST_SPACING_MS = 1_000;

/** The last page an import may ask for: past it the collection is larger than an import may be anyway. */
export const ARCHIDEKT_MAX_PAGE = Math.ceil(COLLECTION_MAX_IMPORT_ROWS / ARCHIDEKT_EXPORT_PAGE_SIZE);

/** Archidekt's "game" parameter: 1 is paper Magic, the only game the app knows. */
const ARCHIDEKT_GAME_PAPER = 1;

export interface CollectionLinkChunk {
  /** CSV for the pages fetched in this call, header included. Later calls' chunks join with `appendCsvPage`. */
  csv: string;
  /** The page to ask for next, or null when the export is complete. */
  nextPage: number | null;
  /** Rows in the whole collection, when Archidekt says. */
  totalRows: number | null;
}

export type CollectionLinkResult = { ok: true; data: CollectionLinkChunk } | { ok: false; error: ApiError };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Up to `ARCHIDEKT_PAGES_PER_CALL` pages of a public Archidekt collection's export, from `fromPage` on.
 *
 * It is the same request Archidekt's own export button makes — a POST naming the columns, one page of 2,500 rows at
 * a time — sent through `fetchShareLink`, so it goes only to archidekt.com, carries the honest User-Agent, follows no
 * redirect and trips the source's kill switch if Archidekt answers with bot protection. Pages are spaced a second
 * apart. A private collection comes back as "not public".
 */
export async function fetchArchidektCollection(db: PublicClient, collectionId: number, fromPage: number): Promise<CollectionLinkResult> {
  let csv = "";
  let totalRows: number | null = null;
  const lastPage = Math.min(fromPage + ARCHIDEKT_PAGES_PER_CALL - 1, ARCHIDEKT_MAX_PAGE);

  for (let page = fromPage; page <= lastPage; page++) {
    if (page > fromPage) await sleep(ARCHIDEKT_REQUEST_SPACING_MS);
    const fetched = await fetchShareLink(db, {
      source: "archidekt",
      url: `https://archidekt.com/api/collection/export/v2/${collectionId}/`,
      expects: "json",
      what: "collection",
      json: { fields: ARCHIDEKT_EXPORT_FIELDS, page, game: ARCHIDEKT_GAME_PAPER, pageSize: ARCHIDEKT_EXPORT_PAGE_SIZE },
    });
    if (!fetched.ok) return fetched;

    let body: unknown;
    try {
      body = JSON.parse(fetched.body);
    } catch {
      body = null;
    }
    const exported = archidektExportPage(body);
    if (!exported) {
      return {
        ok: false,
        error: { code: "UPSTREAM_UNAVAILABLE", message: "Archidekt didn't send a collection we could read. Export it as CSV and upload the file instead." },
      };
    }

    // Refused as soon as the size is known, rather than after downloading 50,000 rows the import would reject.
    if (exported.totalRows !== null && exported.totalRows > COLLECTION_MAX_IMPORT_ROWS) return tooLarge(exported.totalRows);

    csv = appendCsvPage(csv, exported.csv);
    totalRows = exported.totalRows ?? totalRows;
    if (!exported.more) return { ok: true, data: { csv, nextPage: null, totalRows } };
  }

  // Still more at the cap: never hand back a silently shortened collection.
  if (lastPage >= ARCHIDEKT_MAX_PAGE) return tooLarge(totalRows);
  return { ok: true, data: { csv, nextPage: lastPage + 1, totalRows } };
}

const count = (n: number) => n.toLocaleString("en-US");

function tooLarge(rows: number | null): CollectionLinkResult {
  const size = rows === null ? "more than" : `${count(rows)} rows, and imports take up to`;
  return {
    ok: false,
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: `That Archidekt collection has ${size} ${count(COLLECTION_MAX_IMPORT_ROWS)} rows for now. Export part of it as CSV instead.`,
    },
  };
}
