import type { DeckIssue, ResolvedLine } from "@mtg/core/contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ResolutionIssues({ unresolved, issues }: { unresolved: ResolvedLine[]; issues: DeckIssue[] }) {
  if (unresolved.length === 0 && issues.length === 0) return null;

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
      {/* Deck issues are informational; collapsed so cards stay near the top on phones. */}
      {issues.length > 0 && (
        <details className="rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm">
          <summary className="cursor-pointer font-bold marker:text-muted-foreground">
            {issues.length} deck issue{issues.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {issues.map((issue, i) => (
              <li key={`${issue.code}:${issue.cardId ?? i}`}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
