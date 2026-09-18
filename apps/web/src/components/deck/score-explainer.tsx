"use client";

import type { ScoreBreakdown, ScoreComponent } from "@mtg/core/contract";

/**
 * What each component means, in the player's words rather than the scorer's.
 *
 * `blendScore` renormalizes its weights over the components that have data, so the effective weights sum to 1 and
 * `total` is exactly the sum of value × weight. That makes a share of the score an honest number rather than a
 * rounded impression, which is the only reason this panel is worth showing at all.
 */
const LABELS: Record<ScoreComponent, { name: string; blurb: string }> = {
  tag: { name: "Does the same job", blurb: "How closely the two cards' jobs line up" },
  corpus: { name: "Played with this commander", blurb: "How often decks like yours run it" },
  role: { name: "Fills a gap", blurb: "The deck is short on what this card does" },
  manaValue: { name: "Costs about the same", blurb: "Mana value close to the card it replaces" },
  staple: { name: "Widely printed", blurb: "Turns up in a lot of precons and reprints" },
  votes: { name: "What other players picked", blurb: "Votes on this exact swap" },
};

const ORDER: readonly ScoreComponent[] = ["tag", "corpus", "role", "manaValue", "staple", "votes"];

const percent = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Why a component didn't count. "No data" is a poor answer when we know the real one, and two of these are not
 * missing data at all: votes ramp up from nothing with the vote count, and role is only scored for cards to add.
 */
function absentReason(component: ScoreComponent, value: number | null): string {
  switch (component) {
    case "votes":
      return "nobody has voted on this swap yet";
    case "role":
      return "only used for cards to add";
    case "corpus":
      return "no deck data for this commander yet";
    case "tag":
      return "we don't know what this card does yet";
    default:
      return value === null ? "no data" : "not used here";
  }
}

/**
 * Shows how a suggestion's score was arrived at.
 *
 * Every number here already crosses the wire in `ScoreBreakdown` — this renders what the scorer was always
 * reporting. Rows are ordered by what actually moved the ranking, not by the order the components are declared in,
 * because "mostly its play rate" and "mostly its job match" are different answers and the player deserves the real
 * one.
 */
export function ScoreExplainer({ score }: { score: ScoreBreakdown }) {
  const rows = ORDER.map((component) => {
    const value = score.components[component];
    const weight = score.effectiveWeights[component];
    return { component, value, weight, contribution: weight * Math.min(1, Math.max(0, value ?? 0)) };
  });

  const counted = rows.filter((r) => r.weight > 0).sort((a, b) => b.contribution - a.contribution);
  const ignored = rows.filter((r) => r.weight <= 0);
  if (counted.length === 0) return null;

  const lead = counted[0];

  return (
    <details className="mt-4 rounded-lg border border-seam bg-sleeve/40">
      <summary className="cursor-pointer list-none p-3 text-sm font-bold marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <span className="text-primary">Why this card</span>
        {lead && (
          <span className="ml-2 font-normal text-muted-foreground">
            mostly {LABELS[lead.component].name.toLowerCase()}
          </span>
        )}
      </summary>

      <div className="border-t border-seam p-3">
        <ul className="flex flex-col gap-3">
          {counted.map(({ component, value, contribution }) => {
            // Share of the final score, which is what "why" actually means. The bar shows the same number as the
            // figure beside it: a bar of the raw signal next to a weighted percentage reads as one claim and is two.
            const share = score.total > 0 ? contribution / score.total : 0;
            return (
              <li key={component}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-bold">{LABELS[component].name}</span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{percent(share)} of the score</span>
                </div>
                <div
                  role="presentation"
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                  title={`Scored ${percent(value ?? 0)} on this, weighted to ${percent(share)} of the total`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: percent(share) }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{LABELS[component].blurb}</p>
              </li>
            );
          })}
        </ul>

        {ignored.length > 0 && (
          <p className="mt-3 border-t border-seam pt-3 text-xs text-muted-foreground">
            Not counted:{" "}
            {ignored.map(({ component, value }) => `${LABELS[component].name.toLowerCase()} — ${absentReason(component, value)}`).join("; ")}
            .
          </p>
        )}
      </div>
    </details>
  );
}
