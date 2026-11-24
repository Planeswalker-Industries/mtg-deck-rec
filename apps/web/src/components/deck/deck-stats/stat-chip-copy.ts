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

/** Role names as a kind of card ("3 DRAW CARDS"); the rest are the label. */
const ROLE_CARD_NOUNS: Readonly<Record<string, string>> = { "Card advantage": "draw" };

/** "Sorceries" → "Sorcery", "Basic lands" → "Basic land", "White sources" → "White source". */
const singular = (plural: string) => (plural.endsWith("ies") ? `${plural.slice(0, -3)}y` : plural.replace(/s$/, ""));

/**
 * A line's words in a tip, upper case: `stat` names the line ("LAND", "RAMP"), `one` and `many` count its cards ("RAMP
 * CARD", "RAMP CARDS"), `bulk` is the line as a quantity ("LANDS", "RAMP"), `much` says how it piles up.
 */
function tipWords({ group, label }: Pick<RingTipInput, "group" | "label">) {
  if (group === "roles") {
    const stat = (ROLE_NOUNS[label] ?? label).toUpperCase();
    const card = `${(ROLE_CARD_NOUNS[label] ?? label).toUpperCase()} CARD`;
    return { stat, one: card, many: `${card}S`, bulk: stat, much: "MUCH" };
  }
  const many = label.toUpperCase();
  const one = singular(label).toUpperCase();
  return { stat: one, one, many, bulk: many, much: "MANY" };
}

/**
 * A ring's tip, opened by a hover or a tap, in the owner's words (2026-11-24): a label, a colon and what to do. With a
 * card on screen that moves the line: what answering it does ("ADD: TOO MANY LANDS WARNING."). Otherwise what would
 * bring the line in ("WARNING: NEED 3 More LANDS."), or, in range, "LAND Stat: OK.".
 */
export function ringTip(tip: RingTipInput): string {
  const { stat, one, many, bulk, much } = tipWords(tip);
  const count = (n: number) => `${n} ${n === 1 ? one : many}`;
  const short = tip.zone === "low" || tip.zone === "severe";
  // An ignored line reads as ignored whatever card is on screen: the player set it aside.
  if (tip.ignored) return `IGNORE: ${stat} Limit.`;
  const { preview } = tip;
  if (preview && preview.value !== tip.value) {
    const adding = preview.value > tip.value;
    const verb = adding ? "ADD" : "REMOVE";
    if (preview.zone === "over" && tip.zone !== "over") return `${verb}: TOO ${much} ${bulk} WARNING.`;
    if (preview.zone !== "ok" && preview.zone !== "over" && tip.zone === "ok") return `${verb}: LOW ${bulk} WARNING.`;
    if (preview.zone === "ok" && tip.zone === "ok") return `${verb}: OK.`;
    if (preview.better) return adding ? `RECOMMENDATION: ADD this ${one}.` : preview.zone === "ok" ? "RECOMMENDATION: REMOVE OK." : "REMOVE: OK.";
    return short ? `WARNING: ${stat} SHORTAGE.` : `WARNING: TOO ${much} ${bulk}.`;
  }
  if (tip.zone === "severe") return `WARNING: MASSIVE ${stat} SHORTAGE.`;
  if (tip.zone === "low") {
    const need = Math.max(1, tip.low - tip.value);
    return `WARNING: NEED ${need} More ${need === 1 ? one : many}.`;
  }
  if (tip.zone === "over" && tip.high !== null) return `RECOMMENDATION: REMOVE ${count(tip.value - tip.high)}.`;
  return `${stat} Stat: OK.`;
}
