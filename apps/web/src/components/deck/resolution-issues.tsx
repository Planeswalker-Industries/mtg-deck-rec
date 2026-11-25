"use client";

import type { DeckIssue, ResolvedLine } from "@mtg/core/contract";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const issueCount = (n: number) => `${n} deck issue${n === 1 ? "" : "s"}`;

/**
 * `hideIssues`: the deck tool shows no deck issues once a deck is analysed (owner, 2026-11-24: the deck bar's issues
 * chip is retired), so the collapsed list here is only for pages without the bar.
 */
export function ResolutionIssues({
  unresolved,
  issues,
  hideIssues = false,
}: {
  unresolved: ResolvedLine[];
  issues: DeckIssue[];
  hideIssues?: boolean;
}) {
  const listIssues = issues.length > 0 && !hideIssues;
  if (unresolved.length === 0 && !listIssues) return null;

  return (
    <div className="flex flex-col gap-3">
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
      {listIssues && (
        <details className="rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold text-primary">{issueCount(issues.length)}</summary>
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
