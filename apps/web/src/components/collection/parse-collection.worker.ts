/// <reference lib="webworker" />

import type { CollectionRowInput } from "@mtg/core/contract";
import { parseCollectionText } from "@mtg/core/parse";

/**
 * Parses a collection export off the main thread.
 *
 * A 50,000-row CSV is several megabytes read a character at a time, and it produces one object per row. On the main
 * thread that is a visible stall on the tab while the user is watching; here the page stays responsive and can show
 * progress. The parsing itself is the same `parseCollectionText` the rest of the app uses — this file only moves
 * where it runs.
 */

export interface ParseRequest {
  id: number;
  text: string;
}

export type ParseResponse =
  | { id: number; ok: true; rows: CollectionRowInput[] }
  | { id: number; ok: false; message: string };

self.addEventListener("message", (event: MessageEvent<ParseRequest>) => {
  const { id, text } = event.data;
  try {
    const rows = parseCollectionText(text);
    (self as unknown as Worker).postMessage({ id, ok: true, rows } satisfies ParseResponse);
  } catch (err) {
    // A parse that throws is a bug, but it must not leave the import spinning with nothing to show.
    const message = err instanceof Error ? err.message : "Couldn't read that file.";
    (self as unknown as Worker).postMessage({ id, ok: false, message } satisfies ParseResponse);
  }
});
