import type { DeckIssue, ResolvedLine } from "@mtg/core/contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ResolutionIssues({ unresolved, issues }: { unresolved: ResolvedLine[]; issues: DeckIssue[] }) {
  if (unresolved.length === 0 && issues.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {unresolved.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>
            {unresolved.length} line{unresolved.length === 1 ? "" : "s"} couldn&apos;t be matched to a card
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {unresolved.map(({ line }) => (
                <li key={line.lineNo}>
                  Line {line.lineNo}: <span className="font-mono">{line.raw.trim()}</span>
                </li>
              ))}
            </ul>
            <p>Fix these lines and analyze again — recommendations need every card matched.</p>
          </AlertDescription>
        </Alert>
      )}
      {issues.length > 0 && (
        <Alert>
          <AlertTitle>Deck issues</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {issues.map((issue, i) => (
                <li key={`${issue.code}:${issue.cardId ?? i}`}>{issue.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
