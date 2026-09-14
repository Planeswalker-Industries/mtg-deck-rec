"use client";

import { useEffect, useRef } from "react";
import { getApis } from "@/lib/api/client";
import { clearCollection, loadCollection } from "@/lib/collection-store";
import { notifyCollectionChanged } from "./use-collection-source";

/** The server saves at most this many rows per call. */
const ROWS_PER_CALL = 2_000;
const LOCK_NAME = "mtg-deck-rec:collection-move";

async function moveToAccount() {
  const local = await loadCollection();
  if (!local || local.rows.length === 0) return;

  let importId: string | null = null;
  for (let start = 0; start < local.rows.length; start += ROWS_PER_CALL) {
    const result = await getApis().actions.saveCollectionBatch({
      importId,
      sourceApp: "text",
      mode: "merge",
      rows: local.rows.slice(start, start + ROWS_PER_CALL),
      final: start + ROWS_PER_CALL >= local.rows.length,
    });
    if (!result.ok) return;
    importId = result.data.importId;
  }
  await clearCollection();
  notifyCollectionChanged();
}

/**
 * Mounted for signed-in visitors. A collection imported in this browser before signing in moves to the account right
 * away (merged with anything already saved there), and the browser copy is removed. The account only changes when the
 * whole upload commits, so a failed attempt leaves both copies as they were and the next page load tries again. A
 * browser lock stops two open tabs from moving the same collection twice.
 */
export function AccountCollectionSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if ("locks" in navigator) {
      void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (lock) await moveToAccount();
      });
    } else {
      void moveToAccount();
    }
  }, []);

  return null;
}
