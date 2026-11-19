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
