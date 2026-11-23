import type { CompareMark, StatGroup } from "@mtg/core/journey";

// What each ⬆/⬇ chip means, shown when the chip is tapped or hovered (owner, 2026-11-18). The gist comes in the first
// few words; a second short sentence says why that is good or bad here. One wording for a card added, cut or swapped.

/** A Deck stats line's chip: which way the line moves, and whether that brings it toward its target. */
export interface CountTipInput {
  group: StatGroup;
  /** The line's name as Deck stats shows it: "Ramp", "Creatures", "Blue sources". */
  label: string;
  up: boolean;
  better: boolean;
}

/** Groups whose lines count things ("fewer lands"); the roles are amounts ("less ramp"). */
const COUNTABLE_GROUPS: ReadonlySet<StatGroup> = new Set(["mana", "types", "colours"]);

/** Role names that read better another way mid-sentence; the rest are the label in lower case. */
const ROLE_NOUNS: Readonly<Record<string, string>> = {
  "Card advantage": "card draw",
};

const nounOf = ({ group, label }: Pick<CountTipInput, "group" | "label">) =>
  group === "roles"
    ? (ROLE_NOUNS[label] ?? label.toLowerCase())
    : group === "colours"
      ? label.replace(/ sources$/, " mana sources")
      : label.toLowerCase();

/** "More ramp. The deck needs it." and the other three. */
export function countTip(chip: CountTipInput): string {
  const noun = nounOf(chip);
  const less = COUNTABLE_GROUPS.has(chip.group) ? "Fewer" : "Less";
  if (chip.up) return chip.better ? `More ${noun}. The deck needs it.` : `More ${noun} than the deck needs.`;
  return chip.better ? `${less} ${noun}. You have plenty.` : `${less} ${noun}. The deck is short.`;
}

/** How a replacement compares with the card it replaces, by mark and tone. */
const MARK_TIPS: Readonly<Record<CompareMark["key"], Record<CompareMark["tone"], string>>> = {
  cost: { better: "Cheaper to cast.", worse: "Costs more to cast." },
  speed: { better: "Castable at instant speed.", worse: "Sorcery speed only." },
  body: { better: "A bigger creature on the board.", worse: "A smaller creature on the board." },
  play: { better: "Played more with this commander.", worse: "Rarely played with this commander." },
};

export function markTip(mark: Pick<CompareMark, "key" | "tone">): string {
  return MARK_TIPS[mark.key][mark.tone];
}

/** What a ring's tip is about: the line now, its whole-card range, and the line with the card on screen answered. */
export interface RingTipInput {
  group: StatGroup;
  label: string;
  value: number;
  /** Whole counts in line: `low` up to `high` (null: a minimum, no top). */
  low: number;
  high: number | null;
  zone: "severe" | "low" | "ok" | "over";
  ignored: boolean;
  /** With the card on screen answered, when it moves the line. */
  preview?: { value: number; zone: "severe" | "low" | "ok" | "over"; better: boolean } | undefined;
}

/** Role names as a kind of card ("3 draw cards"); the rest are the label in lower case. */
const ROLE_CARD_NOUNS: Readonly<Record<string, string>> = { "Card advantage": "draw" };

/** "3 creatures", "1 creature", "2 ramp cards", "1 white source". */
function cardsOf(group: StatGroup, label: string, n: number): string {
  if (group === "roles") return `${n} ${ROLE_CARD_NOUNS[label] ?? label.toLowerCase()} ${n === 1 ? "card" : "cards"}`;
  const plural = nounOf({ group, label });
  if (n !== 1) return `${n} ${plural}`;
  return `1 ${plural.endsWith("ies") ? `${plural.slice(0, -3)}y` : plural.replace(/s$/, "")}`;
}

/**
 * A ring's tip, opened by a hover or a tap (owner, 2026-11-23). With a card on screen that moves the line: what answering
 * it does ("Adding this gives you too many creatures."). Otherwise what would bring the line in ("Add 3 ramp cards to
 * bring it in line."), or, in range, its count and range.
 */
export function ringTip(tip: RingTipInput): string {
  const noun = nounOf(tip);
  const countable = COUNTABLE_GROUPS.has(tip.group);
  const { preview } = tip;
  if (preview && preview.value !== tip.value) {
    const verb = preview.value > tip.value ? "Adding this" : "Removing this";
    if (preview.zone === "over" && tip.zone !== "over") return `${verb} gives you too ${countable ? "many" : "much"} ${noun}.`;
    if (preview.zone !== "ok" && preview.zone !== "over" && tip.zone === "ok") return `${verb} leaves you too ${countable ? "few" : "little"} ${noun}.`;
    if (preview.zone === "ok" && tip.zone !== "ok") return `${verb} brings ${noun} in line.`;
    if (preview.zone === "ok") return `${verb} keeps ${noun} in range.`;
    return preview.better ? `${verb} gets ${noun} closer to its range.` : `${verb} takes ${noun} further from its range.`;
  }
  const ignored = tip.ignored ? " Ignored: it doesn't count toward the score." : "";
  if (tip.zone === "over" && tip.high !== null) return `Remove ${cardsOf(tip.group, tip.label, tip.value - tip.high)} to bring it in line.${ignored}`;
  if (tip.zone !== "ok") return `Add ${cardsOf(tip.group, tip.label, Math.max(1, tip.low - tip.value))} to bring it in line.${ignored}`;
  const range = tip.high === null ? `${tip.low} or more` : `${tip.low}–${tip.high}`;
  return `${cardsOf(tip.group, tip.label, tip.value)}, in range (${range}).`;
}
