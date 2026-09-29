"use client";

import { TriangleAlert } from "lucide-react";
import type { DeckIssue, ResolvedLine } from "@mtg/core/contract";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PHONE_HIT_AREA } from "@/lib/constants";

const issueCount = (n: number) => `${n} deck issue${n === 1 ? "" : "s"}`;

/**
 * `issuesInDeckBar`: the deck bar shows the issues as a chip on phones (`DeckIssuesChip`), so the collapsed list here
 * is for wider screens only.
 */
export function ResolutionIssues({
  unresolved,
  issues,
  issuesInDeckBar = false,
}: {
  unresolved: ResolvedLine[];
  issues: DeckIssue[];
  issuesInDeckBar?: boolean;
}) {
  if (unresolved.length === 0 && issues.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-3", issuesInDeckBar && unresolved.length === 0 && "max-sm:hidden")}>
      {/* Unmatched lines block recommendations, so they stay expanded. */}
      {unresolved.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>
            {unresolved.length} line{unresolved.length === 1 ? "" : "s"} didn&apos;t match a card
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {unresolved.map(({ line }) => (
                <li key={line.lineNo}>
                  Line {line.lineNo}: {line.raw.trim()}
                </li>
              ))}
            </ul>
            <p>Fix these lines and analyze again. Recommendations need every card matched.</p>
          </AlertDescription>
        </Alert>
      )}
      {/* Deck issues are informational; collapsed so cards stay near the top. */}
      {issues.length > 0 && (
        <details className={cn("rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm", issuesInDeckBar && "max-sm:hidden")}>
          <summary className="cursor-pointer font-semibold marker:text-muted-foreground">{issueCount(issues.length)}</summary>
          <IssueList issues={issues} className="mt-2" />
        </details>
      )}
    </div>
  );
}

function IssueList({ issues, className }: { issues: DeckIssue[]; className?: string }) {
  return (
    <ul className={cn("list-disc pl-5 text-muted-foreground", className)}>
      {issues.map((issue, i) => (
        <li key={`${issue.code}:${issue.cardId ?? i}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

/**
 * Deck issues as a chip in the deck bar on phones: the count behind a warning sign, opening the list in a bottom
 * sheet. A full-width row above the bar cost the swipe cards their height.
 */
export function DeckIssuesChip({ issues }: { issues: DeckIssue[] }) {
  if (issues.length === 0) return null;
  const label = issueCount(issues.length);
  return (
    <Sheet>
      <SheetTrigger
        aria-label={label}
        title={label}
        className={cn(
          PHONE_HIT_AREA,
          "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-seam bg-sleeve px-2 font-mono text-xs text-foreground sm:hidden",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <TriangleAlert aria-hidden className="size-3.5 text-cut" />
        {issues.length}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-xl gap-0 overflow-y-auto rounded-t-2xl border-seam bg-sleeve px-4 pt-5 pb-6"
      >
        <SheetHeader className="p-0 pr-8">
          <SheetTitle className="font-heading text-xl font-semibold tracking-tight">{label}</SheetTitle>
          <SheetDescription>Worth fixing, but they don&apos;t stop the recommendations.</SheetDescription>
        </SheetHeader>
        <IssueList issues={issues} className="mt-3 text-sm" />
      </SheetContent>
    </Sheet>
  );
}
