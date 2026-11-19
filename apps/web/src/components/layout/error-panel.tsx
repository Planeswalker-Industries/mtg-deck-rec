"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

/** What app/error.tsx and app/global-error.tsx show: a render error, then Try again or Home. */
export function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section aria-labelledby="error-heading" className="flex max-w-prose flex-col gap-4 py-8">
      <h1 id="error-heading" className="flex items-center gap-2 font-heading text-2xl leading-none font-semibold tracking-tight">
        <TriangleAlert aria-hidden className="size-6 shrink-0 text-warning" />
        Something broke
      </h1>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Home
        </Link>
      </div>
    </section>
  );
}
