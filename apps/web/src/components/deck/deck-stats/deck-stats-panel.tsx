import type { ReactNode } from "react";
import type { CardId, CardSummary } from "@mtg/core/contract";
import type { DeckStatsReport, StatLine } from "@mtg/core/journey";
import { ArrowDown, ArrowUp, Check, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { LevelBadge } from "./level";
import { StatBar } from "./stat-bar";

/** Percent of a curve column's height a value can take. */
const FULL_COLUMN_PCT = 100;
/** Room above the tallest bar or tick, so a tick at the curve's maximum stays inside the box (as StatBar's track). */
const COLUMN_HEADROOM = 1.15;

const columnPct = (n: number, scale: number) => `${Math.max(0, Math.min(FULL_COLUMN_PCT, (n / scale) * FULL_COLUMN_PCT))}%`;

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
    <Check role="img" aria-label="In line" className="size-4 shrink-0 text-muted-foreground" />
  ) : (
    <TriangleAlert role="img" aria-label="Off" className="size-4 shrink-0 text-warning" />
  );
}

function ActionLink({ action, className }: { action: StatAction; className?: string }) {
  return (
    <button type="button" className={cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer", className)} onClick={action.onSelect}>
      {action.label}
    </button>
  );
}

/** Whether moving a count by `delta` brings it closer to its target. */
export const towardTarget = (value: number, target: number, delta: number) => Math.abs(value + delta - target) < Math.abs(value - target);

/**
 * What answering the card on screen would do to a line: "+1" or "−1", green with an up arrow when it moves the count
 * toward its target, red with a down arrow when away.
 */
export function PreviewDelta({ value, target, delta }: { value: number; target: number; delta: number }) {
  const better = towardTarget(value, target, delta);
  const Icon = better ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-mono text-xs", better ? "text-success" : "text-destructive")}>
      <Icon aria-hidden className="size-3" strokeWidth={2.75} />
      {delta > 0 ? `+${delta}` : `−${-delta}`}
      <span className="sr-only">{better ? ", toward the target" : ", away from the target"}</span>
    </span>
  );
}

/**
 * One stat on one line: its mark, its name, what to do about it when it's off, then the count against the target (amber
 * when off) with how far it moved this round. A thin bar under it. When a card is on screen, what answering it would
 * change shows beside the count and as a striped piece of the bar.
 */
function Row({ stat, action, preview }: { stat: StatLine; action: StatAction | null; preview: number }) {
  const moved = stat.value - stat.start;
  return (
    <li className={cn("flex flex-col gap-1 rounded-md", preview !== 0 && "-mx-1.5 bg-foreground/5 px-1.5 py-1")}>
      <div className="flex items-center gap-2 text-sm">
        <Mark ok={stat.ok} />
        <span className="min-w-0 truncate">{stat.label}</span>
        {action && <ActionLink action={action} className="shrink-0 text-xs" />}
        <span className="ml-auto flex shrink-0 items-baseline gap-2">
          {moved !== 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              {moved > 0 ? `+${moved}` : `−${-moved}`}
              <span className="sr-only"> this round</span>
            </span>
          )}
          {preview !== 0 && <PreviewDelta value={stat.value} target={stat.target} delta={preview} />}
          <span className="font-mono">
            <span className={cn(!stat.ok && "text-warning")}>{stat.value}</span>
            <span className="text-muted-foreground"> / {Math.round(stat.target)}</span>
          </span>
        </span>
      </div>
      <StatBar value={stat.value} target={stat.target} start={stat.start} ok={stat.ok} preview={preview} />
      {!stat.ok && <span className="sr-only">{offBy(stat.value, stat.target)}</span>}
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

/**
 * Curve bars as small columns: the deck's count with the target as a tick, a fainter, narrower tick where the bar stood
 * when the round started, mana value under each.
 */
function CurveRows({ report }: { report: DeckStatsReport }) {
  const bars = report.curve.bars;
  const lastIndex = bars.length - 1;
  const scale = Math.max(1, ...bars.flatMap((b) => [b.value, b.target, b.start])) * COLUMN_HEADROOM;
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
              className={cn("w-full rounded-t-sm", b.ok ? "bg-muted-foreground/60" : "bg-warning/80")}
              style={{ height: columnPct(b.value, scale) }}
            />
            <div className="absolute inset-x-0 h-0.5 bg-foreground/70" style={{ bottom: columnPct(b.target, scale) }} />
            {b.start !== b.value && (
              <div className="absolute inset-x-1 h-0.5 bg-muted-foreground/60" style={{ bottom: columnPct(b.start, scale) }} />
            )}
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
                {b.start !== b.value && ` (was ${b.start})`}
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
  preview,
}: {
  report: DeckStatsReport;
  /** Names for combo pieces. */
  cards: ReadonlyMap<CardId, CardSummary>;
  actionFor?: (stat: StatLine) => StatAction | null;
  bracketAction?: StatAction | null;
  /** How answering the card on screen would move each line (statDeltas), when one is on screen. */
  preview?: ReadonlyMap<string, number> | null;
}) {
  const mana = report.stats.filter((s) => s.group === "mana");
  const roles = report.stats.filter((s) => s.group === "roles");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Compared with {report.label}</p>
      <Group title="Mana">
        <ul className="flex flex-col gap-2.5">
          {mana.map((s) => (
            <Row key={s.key} stat={s} action={actionFor?.(s) ?? null} preview={preview?.get(s.key) ?? 0} />
          ))}
        </ul>
      </Group>
      <Group title="Roles">
        <ul className="flex flex-col gap-2.5">
          {roles.map((s) => (
            <Row key={s.key} stat={s} action={actionFor?.(s) ?? null} preview={preview?.get(s.key) ?? 0} />
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
