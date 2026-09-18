"use client";

import { useCallback, useEffect, useRef } from "react";
import type { CollectionRowInput } from "@mtg/core/contract";
import { parseCollectionText } from "@mtg/core/parse";
import type { ParseRequest, ParseResponse } from "./parse-collection.worker";

/**
 * Parses collection exports in a Web Worker, falling back to the main thread.
 *
 * The fallback is not a nicety: a worker needs a same-origin module script, which a strict Content-Security-Policy
 * or a browser we haven't thought about can refuse. A collection import must not be the thing that breaks there, and
 * the result is identical either way — the worker only moves where `parseCollectionText` runs.
 *
 * The worker is created on first use rather than on mount, so a visit that never imports anything never pays for it.
 */
export function useCollectionParser(): (text: string) => Promise<CollectionRowInput[]> {
  const workerRef = useRef<Worker | null>(null);
  /** Null until we've tried; false once creating a worker has failed, so we stop trying. */
  const supported = useRef<boolean | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return useCallback(async (text: string) => {
    if (supported.current !== false && workerRef.current === null) {
      try {
        workerRef.current = new Worker(new URL("./parse-collection.worker.ts", import.meta.url));
        supported.current = true;
      } catch {
        supported.current = false;
      }
    }

    const worker = workerRef.current;
    if (!worker) return parseCollectionText(text);

    const id = ++nextId.current;
    return new Promise<CollectionRowInput[]>((resolve) => {
      const onMessage = (event: MessageEvent<ParseResponse>) => {
        // Only this request's answer; an earlier import the user has moved on from is ignored.
        if (event.data.id !== id) return;
        cleanup();
        resolve(event.data.ok ? event.data.rows : parseCollectionText(text));
      };
      // A worker that dies mid-parse still owes an answer, so fall back rather than hanging the import.
      const onError = () => {
        cleanup();
        worker.terminate();
        workerRef.current = null;
        supported.current = false;
        resolve(parseCollectionText(text));
      };
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ id, text } satisfies ParseRequest);
    });
  }, []);
}
