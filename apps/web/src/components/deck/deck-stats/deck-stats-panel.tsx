"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import type { CardId, CardSummary } from "@mtg/core/contract";
import {
  BRACKET_LINE,
  CURVE_LINE,
  KARSTEN_ARTICLE_URL,
  stateFlips,
  towardTarget,
  type DeckStatsReport,
  type StatLine,
} from "@mtg/core/journey";
import { ArrowRight, Check, ChevronDown, CircleHelp, X } from "lucide-react";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { markRingHintSeen, readRingHintSeen } from "@/lib/ring-hint";
import { LevelBadge, Mark } from "./level";
import { BudgetRow, type RoundBudget } from "./budget-row";
import { StatRings } from "./stat-ring";

/** The stripes on a previewed piece of a curve column: the card on screen would add it, or take it away. */
const STRIPES = "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 4px)";

/** A whole in percent: a curve column's full height, a chance of 1. */
const PERCENT = 100;
/** Room above the tallest bar or tick, so a tick at the curve's maximum stays inside the box. */
const COLUMN_HEADROOM = 1.15;
/** How long a curve column takes to grow in, and how far behind the one to its left it starts. */
const CURVE_GROW_S = 0.5;
const CURVE_STAGGER_S = 0.06;
/** Hard-to-cast cards shown before "Show all" (owner, 2026-11-02). */
const HARD_TO_CAST_SHOWN = 5;
/** Rendered width of a hard-to-cast thumbnail (w-10), for CardImage's sizes. */
const THUMB_SIZES = "40px";

const columnPct = (n: number, scale: number) => `${Math.max(0, Math.min(PERCENT, (n / scale) * PERCENT))}%`;

export interface StatAction {
  label: string;
  onSelect: () => void;
}

/** "6 short", "3 over": whole cards against the target as shown. */
export function offBy(value: number, target: number): string {
  const delta = value - Math.round(target);
  return delta < 0 ? `${-delta} short` : `${delta} over`;
}

function ActionLink({ action, className }: { action: StatAction; className?: string }) {
  return (
    <button type="button" className={cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer", className)} onClick={action.onSelect}>
      {action.label}
    </button>
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
 * when the round started, mana value under each. With a card on screen, a striped piece shows where each bar would go
 * (green toward its target, red away), and the curve's state when the card flips it.
 */
function CurveRows({
  report,
  action,
  after,
  flip,
}: {
  report: DeckStatsReport;
  action: StatAction | null;
  after: DeckStatsReport | null;
  flip: Flip | undefined;
}) {
  const bars = report.curve.bars;
  const lastIndex = bars.length - 1;
  const moved = bars.map((b, i) => (after?.curve.bars[i]?.value ?? b.value) - b.value);
  const previewed = moved.some((d) => d !== 0) || flip !== undefined;
  const scale = Math.max(1, ...bars.flatMap((b, i) => [b.value + Math.max(0, moved[i]!), b.target, b.start])) * COLUMN_HEADROOM;
  const off = bars.filter((b) => !b.ok).map((b) => barLabel(b.manaValue, b.manaValue === lastIndex));
  const ignored = report.curve.state === "ignored";
  const reduceMotion = useReducedMotion() ?? false;
  const columns = useRef<HTMLDivElement>(null);
  const inView = useInView(columns, { once: true });
  return (
    <div className={cn("flex flex-col gap-1.5", previewed && PREVIEWED)}>
      <div className={cn("flex items-center gap-2 text-sm", ignored && "text-muted-foreground")}>
        <Mark state={report.curve.state} />
        <span className="flex-1">
          Mana curve
          {action && <ActionLink action={action} className="ml-2 text-xs" />}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {report.curve.ok ? "OK" : `${ignored ? "Ignored · off" : "Off"} at ${off.join(", ")}`}
        </span>
        {flip && <FlipTag to={flip} />}
      </div>
      <div ref={columns} aria-hidden className="flex h-12 items-end gap-1 border-b border-seam">
        {bars.map((b, i) => (
          <div key={b.manaValue} className="relative flex h-full flex-1 items-end">
            {/* Each column grows in as the curve comes into view, left to right (owner, 2026-11-23: a nice-to-have). */}
            <motion.div
              className={cn("w-full rounded-t-sm", b.ok || ignored ? "bg-muted-foreground/60" : "bg-warning/80")}
              initial={reduceMotion ? false : { height: 0 }}
              animate={{ height: inView || reduceMotion ? columnPct(b.value, scale) : 0 }}
              transition={{ duration: reduceMotion ? 0 : CURVE_GROW_S, delay: reduceMotion ? 0 : i * CURVE_STAGGER_S, ease: "easeOut" }}
            />
            {moved[i] !== 0 && (
              <div
                className={cn("absolute inset-x-0", towardTarget(b.value, b.target, moved[i]!) ? "text-success" : "text-destructive")}
                style={{
                  bottom: columnPct(Math.min(b.value, b.value + moved[i]!), scale),
                  height: columnPct(Math.abs(moved[i]!), scale),
                  backgroundImage: STRIPES,
                }}
              />
            )}
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
                {moved[i] !== 0 && `, ${b.value + moved[i]!} with this card`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const pct = (chance: number) => `${Math.round(chance * PERCENT)}%`;

/** The Lands line's key: its tip carries the odds of hitting land drops. */
const LANDS_LINE = "lands";

/** "Odds: 3 lands by turn 3 93% · 4 by turn 4 80% · …", for the Lands ring's tip; undefined without odds. */
const landOdds = (byTurn: DeckStatsReport["mana"]["byTurn"]) =>
  byTurn.length === 0
    ? undefined
    : `Odds: ${byTurn.map((b, i) => `${b.turn}${i === 0 ? " lands" : ""} by turn ${b.turn} ${pct(b.chance)}`).join(" · ")}.`;

/** What the colour estimate rests on, behind a (?) so the group stays short. */
function ColoursHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={PHONE_HIT_AREA} aria-label="About the colour estimate">
          <CircleHelp aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colour estimate</DialogTitle>
          <DialogDescription>
            Sources needed come from Frank Karsten&apos;s 2022 tables for 99-card decks. Odds assume you keep a 7-card hand with 2 to 5
            lands and draw on turn one. Mana rocks, dorks and ramp count partly, as he counts them.
          </DialogDescription>
        </DialogHeader>
        <a href={KARSTEN_ARTICLE_URL} target="_blank" rel="noreferrer" className={cn(TEXT_LINK, PHONE_HIT_AREA, "self-start text-sm")}>
          Karsten&apos;s article
        </a>
      </DialogContent>
    </Dialog>
  );
}

/** Nothing to subscribe to: `useSyncExternalStore` only keeps the server render (no hint) apart from the client's. */
const subscribeNothing = () => () => {};

/**
 * Whether this panel shows the first-time hint. Read after hydration (the server never shows it), and kept for as long
 * as the panel stays mounted, so marking the hint seen doesn't take it away from the screen it's on.
 */
function useRingHint(): boolean {
  const seen = useSyncExternalStore(subscribeNothing, readRingHintSeen, () => true);
  const [shown, setShown] = useState(false);
  if (!seen && !shown) setShown(true);
  return shown;
}

/**
 * "Close every ring.", in the buddy's voice, once per browser (owner, 2026-11-23). Marked seen only once it is on
 * screen: the rail is mounted but hidden on phones, and must not use the hint up there.
 */
function RingHint() {
  const line = useRef<HTMLParagraphElement>(null);
  const inView = useInView(line, { once: true });
  useEffect(() => {
    if (inView) markRingHintSeen();
  }, [inView]);
  return (
    <p ref={line} className="font-drama text-base text-foreground/85 italic">
      Close every ring.
    </p>
  );
}

/** The state a line would end in with the card on screen answered, when that differs from now. */
type Flip = "ok" | "off";

/** The background a line moved by the card on screen gets, so the lines it touches stand out in the list. */
const PREVIEWED = "-mx-1.5 rounded-md bg-foreground/5 px-1.5 py-1";

/**
 * "→ OK" or "→ Off": the state a line would end in with the card on screen answered, when the card flips it. These are
 * the lines that move the score beside the level badge.
 */
function FlipTag({ to }: { to: Flip }) {
  const Icon = to === "ok" ? Check : X;
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold">
      <ArrowRight aria-hidden className="size-3 text-muted-foreground" />
      <span className="sr-only">With this card: </span>
      <span className={cn("inline-flex items-center gap-0.5", to === "ok" ? "text-success" : "text-destructive")}>
        <Icon aria-hidden className="size-3" strokeWidth={2.75} />
        {to === "ok" ? "OK" : "Off"}
      </span>
    </span>
  );
}

/**
 * The cards least likely to be cast on curve, worst first, each with its image. Folded by default behind its count, so
 * the Colours group stays short (owner, 2026-11-23).
 */
function HardToCast({ report, cards }: { report: DeckStatsReport; cards: ReadonlyMap<CardId, CardSummary> }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const panelId = useId();
  // Every card shown shows its image: one the panel can't find is left out.
  const listed = report.mana.hardToCast.filter((h) => cards.has(h.cardId));
  if (listed.length === 0) return null;
  const shown = all ? listed : listed.slice(0, HARD_TO_CAST_SHOWN);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md text-left text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Hard to cast ({listed.length})
        {/* At the right edge, as Budget's. */}
        <ChevronDown aria-hidden className={cn("ml-auto size-4 shrink-0 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <HardToCastList id={panelId} listed={listed} shown={shown} cards={cards} all={all} onAll={() => setAll(true)} />}
    </div>
  );
}

function HardToCastList({
  id,
  listed,
  shown,
  cards,
  all,
  onAll,
}: {
  id: string;
  listed: DeckStatsReport["mana"]["hardToCast"];
  shown: DeckStatsReport["mana"]["hardToCast"];
  cards: ReadonlyMap<CardId, CardSummary>;
  all: boolean;
  onAll: () => void;
}) {
  return (
    <div id={id} className="flex flex-col gap-2">
      <ul aria-label="Hard to cast on curve" className="flex flex-col gap-2">
        {shown.map((h) => {
          const card = cards.get(h.cardId)!;
          return (
            <li key={h.cardId} className="flex items-center gap-2 text-sm">
              <CardImage card={card} variant="small" alt="" sizes={THUMB_SIZES} className="w-10 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {card.name}
                {h.commander && <span className="text-xs text-muted-foreground"> · Commander</span>}
              </span>
              <span className="shrink-0 font-mono text-xs">
                {pct(h.chance)} · turn {h.turn}
              </span>
            </li>
          );
        })}
      </ul>
      {listed.length > HARD_TO_CAST_SHOWN && !all && (
        <Button type="button" variant="ghost" className={cn(PHONE_HIT_AREA, "self-start text-xs")} onClick={onAll}>
          Show all ({listed.length})
        </Button>
      )}
    </div>
  );
}

export function DeckStatsPanel({
  report,
  cards,
  actionFor,
  curveAction,
  bracketAction,
  combosAction,
  after = null,
  money = null,
}: {
  /** The round's money and the budget's fields (T091): the Budget row at the top. */
  money?: RoundBudget | null;
  report: DeckStatsReport;
  /** Names for combo pieces. */
  cards: ReadonlyMap<CardId, CardSummary>;
  /** What an off line offers: "Fix", opening Fix at that line. */
  actionFor?: (stat: StatLine) => StatAction | null;
  curveAction?: StatAction | null;
  bracketAction?: StatAction | null;
  /** "Find combos": opens Add's Combos, in the deck tool when it has any. */
  combosAction?: StatAction | null;
  /**
   * The deck graded with the card on screen answered (`reportWithMoves`), when one is on screen: the lines it would flip
   * and the curve it would leave. Only its values and states are read.
   */
  after?: DeckStatsReport | null;
}) {
  const flips = after ? stateFlips(report, after) : null;
  const bracketFlip = flips?.get(BRACKET_LINE);
  const mana = report.stats.filter((s) => s.group === "mana");
  const roles = report.stats.filter((s) => s.group === "roles");
  const types = report.stats.filter((s) => s.group === "types");
  const colours = report.stats.filter((s) => s.group === "colours");
  // The rail and the phone sheet can both be mounted: the heading id must be unique.
  const coloursHeading = useId();
  // Each ring moves to its line in the deck as the card on screen would leave it.
  const afterByKey = after ? new Map(after.stats.map((s) => [s.key, s])) : null;
  const afterFor = (line: StatLine) => afterByKey?.get(line.key);
  const hint = useRingHint();
  const actionNode = (line: StatLine) => {
    const action = actionFor?.(line);
    return action ? <ActionLink action={action} /> : null;
  };
  return (
    <div className="flex flex-col gap-4">
      {money && <BudgetRow money={money} />}
      <p className="text-sm text-muted-foreground">Compared with {report.label}</p>
      {hint && <RingHint />}
      {/* The main lines in one block of big rings, so a short group doesn't leave a half-empty row. */}
      <Group title="Mana and roles">
        <StatRings
          label="Mana and roles"
          lines={[...mana, ...roles]}
          size="lg"
          afterFor={afterFor}
          actionFor={actionNode}
          tipExtraFor={(line) => (line.key === LANDS_LINE ? landOdds(report.mana.byTurn) : undefined)}
        />
      </Group>
      {(colours.length > 0 || report.mana.hardToCast.length > 0) && (
        <section className="flex flex-col gap-2" aria-labelledby={coloursHeading}>
          <div className="flex items-center gap-2">
            <h3 id={coloursHeading} className="flex-1 text-sm font-semibold text-muted-foreground">
              Colours
            </h3>
            <span className="text-xs text-muted-foreground">Estimate</span>
            <ColoursHelp />
          </div>
          <StatRings label="Colour sources" lines={colours} size="mana" afterFor={afterFor} actionFor={actionNode} />
          <HardToCast report={report} cards={cards} />
        </section>
      )}
      <Group title="Curve">
        <CurveRows report={report} action={curveAction ?? null} after={after} flip={flips?.get(CURVE_LINE)} />
      </Group>
      {types.length > 0 && (
        <Group title="Types">
          <StatRings label="Types" lines={types} size="sm" afterFor={afterFor} actionFor={actionNode} />
        </Group>
      )}
      <Group title="Bracket">
        <div className={cn("flex items-center gap-2 text-sm", bracketFlip && PREVIEWED)}>
          <Mark state={report.bracket.ok ? "ok" : "off"} />
          <span className="flex-1">
            {report.bracket.ok ? "Fits" : "Over"} bracket {report.bracket.chosen}
          </span>
          {bracketFlip && <FlipTag to={bracketFlip} />}
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
                <a href={combo.url} target="_blank" rel="noreferrer" className={cn(TEXT_LINK, PHONE_HIT_AREA, "self-start text-xs")}>
                  Commander Spellbook
                </a>
              </li>
            ))}
          </ul>
        )}
        {combosAction && <ActionLink action={combosAction} className="self-start text-xs" />}
      </Group>
    </div>
  );
}

export { LevelBadge };
