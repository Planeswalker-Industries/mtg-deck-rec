import type { ReactNode } from "react";
import type { CardId, CardSummary } from "@mtg/core/contract";
import type { DeckStatsReport, StatLine } from "@mtg/core/journey";
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { LevelBadge } from "./level";
import { StatBar } from "./stat-bar";

/** Percent of a curve column's height a value can take. */
const FULL_COLUMN_PCT = 100;

export interface StatAction {
  label: string;
  onSelect: () => void;
}

/** "6 short", "3 over": whole cards against the target as shown. */
function offBy(value: number, target: number): string {
  const delta = value - Math.round(target);
  return delta < 0 ? `${-delta} short` : `${delta} over`;
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check role="img" aria-label="In line" className="size-4 shrink-0 text-stat-ok" />
  ) : (
    <TriangleAlert role="img" aria-label="Off" className="size-4 shrink-0 text-stat-mild" />
  );
}

function ActionLink({ action, className }: { action: StatAction; className?: string }) {
  return (
    <button type="button" className={cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer", className)} onClick={action.onSelect}>
      {action.label}
    </button>
  );
}

function Row({ stat, action }: { stat: StatLine; action: StatAction | null }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-sm">
        <Mark ok={stat.ok} />
        <span className="min-w-0 flex-1 truncate">{stat.label}</span>
        <span className="font-mono">
          {stat.value} / {Math.round(stat.target)}
        </span>
      </div>
      <StatBar value={stat.value} target={stat.target} start={stat.start} ok={stat.ok} />
      {!stat.ok && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
          <span>{offBy(stat.value, stat.target)}</span>
          {action && <ActionLink action={action} />}
        </div>
      )}
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** The last curve bar holds that mana value and up. */
const barLabel = (manaValue: number, last: boolean) => (last ? `${manaValue}+` : String(manaValue));

/** Curve bars as small columns: the deck's count with the target as a tick, mana value under each. */
function CurveRows({ report }: { report: DeckStatsReport }) {
  const bars = report.curve.bars;
  const lastIndex = bars.length - 1;
  const max = Math.max(1, ...bars.flatMap((b) => [b.value, b.target]));
  const off = bars.filter((b) => !b.ok).map((b) => barLabel(b.manaValue, b.manaValue === lastIndex));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm">
        <Mark ok={report.curve.ok} />
        <span className="flex-1">Mana curve</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {report.curve.ok ? "In line" : `Off at ${off.join(", ")}`}
        </span>
      </div>
      <div aria-hidden className="flex h-12 items-end gap-1 border-b border-seam">
        {bars.map((b) => (
          <div key={b.manaValue} className="relative flex h-full flex-1 items-end">
            <div
              className={cn("w-full rounded-t-sm", b.ok ? "bg-stat-ok/80" : "bg-stat-mild/80")}
              style={{ height: `${(b.value / max) * FULL_COLUMN_PCT}%` }}
            />
            <div
              className="absolute inset-x-0 h-0.5 bg-foreground/70"
              style={{ bottom: `${(b.target / max) * FULL_COLUMN_PCT}%` }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="flex gap-1 text-center font-mono text-xs text-muted-foreground">
        {bars.map((b, i) => (
          <span key={b.manaValue} className="flex-1">
            {barLabel(b.manaValue, i === lastIndex)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Mana curve against the target</caption>
        <tbody>
          {bars.map((b, i) => (
            <tr key={b.manaValue}>
              <th scope="row">Mana value {barLabel(b.manaValue, i === lastIndex)}</th>
              <td>
                {b.value} of {Math.round(b.target)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeckStatsPanel({
  report,
  cards,
  actionFor,
  bracketAction,
}: {
  report: DeckStatsReport;
  /** Names for combo pieces. */
  cards: ReadonlyMap<CardId, CardSummary>;
  actionFor?: (stat: StatLine) => StatAction | null;
  bracketAction?: StatAction | null;
}) {
  const mana = report.stats.filter((s) => s.group === "mana");
  const roles = report.stats.filter((s) => s.group === "roles");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Compared with {report.label}</p>
      <Group title="Mana">
        <ul className="flex flex-col gap-3">
          {mana.map((s) => (
            <Row key={s.key} stat={s} action={actionFor?.(s) ?? null} />
          ))}
        </ul>
      </Group>
      <Group title="Roles">
        <ul className="flex flex-col gap-3">
          {roles.map((s) => (
            <Row key={s.key} stat={s} action={actionFor?.(s) ?? null} />
          ))}
        </ul>
      </Group>
      <Group title="Curve">
        <CurveRows report={report} />
      </Group>
      <Group title="Bracket">
        <div className="flex items-center gap-2 text-sm">
          <Mark ok={report.bracket.ok} />
          <span className="flex-1">
            {report.bracket.ok ? "Fits" : "Over"} bracket {report.bracket.chosen}
          </span>
          <span className="text-xs text-muted-foreground">Estimated</span>
        </div>
        {!report.bracket.ok && bracketAction && <ActionLink action={bracketAction} className="self-start text-xs" />}
        {report.bracket.combos.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {report.bracket.combos.map((combo) => (
              <li key={combo.id} className="flex flex-col gap-0.5">
                <span>{combo.results[0] ?? "Combo"}</span>
                <span className="text-xs text-muted-foreground">
                  {combo.pieceIds.map((id) => cards.get(id)?.name ?? "Unknown card").join(" + ")}
                  {combo.alsoNeeded.length > 0 ? ` + ${combo.alsoNeeded.join(", ")}` : ""}
                </span>
                <a
                  href={combo.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(TEXT_LINK, PHONE_HIT_AREA, "self-start text-xs")}
                >
                  Commander Spellbook
                </a>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  );
}

export { LevelBadge };
