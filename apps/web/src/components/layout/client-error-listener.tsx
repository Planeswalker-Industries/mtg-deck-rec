"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-report";

/**
 * Messages that aren't failures of this site: the browser's own layout notice, and a cross-origin script's error,
 * which the browser hides behind "Script error." with nothing to act on.
 */
const NOISE = [/^ResizeObserver loop/, /^Script error\.?$/];

/**
 * Errors nothing else caught in the browser: an uncaught exception or an unhandled promise rejection, from this site's
 * own scripts. Each becomes an error ticket. Extensions and third-party scripts are left out by origin.
 */
export function ClientErrorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (event.filename && !event.filename.startsWith(window.location.origin)) return;
      if (NOISE.some((pattern) => pattern.test(event.message))) return;
      reportClientError("window.error", event.error ?? event.message, {
        context: { line: event.lineno || null, column: event.colno || null },
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      // A navigation or a superseded fetch cancels on purpose.
      if (event.reason instanceof DOMException && event.reason.name === "AbortError") return;
      reportClientError("window.unhandledRejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
