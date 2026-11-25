"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { cn } from "cn";
import { reportClientError } from "@/lib/client-error-report";
import { PAGE_SHEET, SEAL_BUTTON, SEAL_OUTLINE_BUTTON } from "@/lib/constants";

/**
 * What app/error.tsx and app/global-error.tsx show: a render error, then Try again or Home.
 *
 * Every one is an error ticket. A server error (it has a digest) was ticketed where it happened, by
 * `instrumentation.ts`; a client component's is only seen here, so this sends it. The digest is shown as the error id,
 * so a player's report or screenshot finds its ticket.
 */
export function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    if (!error.digest) reportClientError("boundary.render", error);
  }, [error]);

  return (
    <section aria-labelledby="error-heading" className={cn(PAGE_SHEET, "max-w-prose")}>
      <h1 id="error-heading" className="flex items-center gap-2 font-heading text-2xl leading-none font-semibold tracking-tight">
        <TriangleAlert aria-hidden className="size-6 shrink-0 text-warning" />
        Something broke
      </h1>
      {error.digest && (
        <p className="text-sm text-muted-foreground">
          Error id <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SEAL_BUTTON} onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className={SEAL_OUTLINE_BUTTON}>
          Home
        </Link>
      </div>
    </section>
  );
}
