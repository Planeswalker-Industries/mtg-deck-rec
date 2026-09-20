import Image from "next/image";
import type { CardCategory } from "@mtg/core/contract";
import { cardCategoryLabel } from "@/lib/labels";
import type { ColorKey } from "@/lib/featured-decks";
import { COLOR_NAMES, MANA_SYMBOL_URL } from "@/components/deck/color-identity";

/** Legend and ring order, matching the homepage mock: lands first, battle last. */
const CATEGORY_ORDER: readonly CardCategory[] = [
  "land",
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "planeswalker",
  "battle",
];

/** CSS color token for each card category, matching the --color-cat-* tokens in globals.css. */
const CAT_COLORS: Record<CardCategory, string> = {
  land: "var(--color-cat-land)",
  creature: "var(--color-cat-creature)",
  instant: "var(--color-cat-instant)",
  sorcery: "var(--color-cat-sorcery)",
  artifact: "var(--color-cat-artifact)",
  enchantment: "var(--color-cat-enchantment)",
  planeswalker: "var(--color-cat-planeswalker)",
  battle: "var(--color-cat-battle)",
};

const COLOR_ORDER: readonly ColorKey[] = ["W", "U", "B", "R", "G", "C"];

/**
 * An inline SVG donut chart with legend and a mana-symbol row, showing the card-type composition and
 * color split of a deck. Pure presentational, no state. The ring is the shape and the legend is the data.
 *
 * The ring's `role="img"` carries an `aria-label` naming every category and count (zeroes included,
 * so no category can silently disappear), because a donut is unreadable to a screen reader.
 */
export function DeckOverview({
  composition,
  colorCounts,
  cardCount,
}: {
  composition: Record<CardCategory, number>;
  colorCounts: Record<ColorKey, number>;
  cardCount: number;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const total = Object.values(composition).reduce((a, b) => a + b, 0);

  // Legend rows only for categories the deck has; the aria-label still names all of them.
  const rows = CATEGORY_ORDER.filter((cat) => composition[cat] > 0);
  const colors = COLOR_ORDER.filter((key) => key === "C" || colorCounts[key] > 0);

  const ariaLabel = CATEGORY_ORDER.map((cat) => `${cardCategoryLabel[cat]}: ${composition[cat]}`).join(", ");

  // Each segment starts where the previous one ended.
  const segments = rows.map((cat, idx) => {
    const count = composition[cat];
    const share = total > 0 ? count / total : 0;
    const dashLength = share * circumference;
    const gapLength = circumference - dashLength;
    const previousCount = rows.slice(0, idx).reduce((sum, prev) => sum + composition[prev], 0);
    const offset = -(previousCount / total) * circumference;
    return { cat, dashLength, gapLength, offset };
  });

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">Deck overview</h4>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex flex-col items-center gap-3">
          <svg role="img" aria-label={ariaLabel} viewBox="0 0 100 100" className="size-32 shrink-0 sm:size-36">
            <g transform="rotate(-90 50 50)">
              {segments.map(({ cat, dashLength, gapLength, offset }) => (
                <circle
                  key={cat}
                  cx="50"
                  cy="50"
                  r={String(radius)}
                  fill="none"
                  stroke={CAT_COLORS[cat]}
                  strokeDasharray={`${dashLength} ${gapLength}`}
                  strokeDashoffset={String(offset)}
                  strokeWidth="14"
                />
              ))}
            </g>
            {/* Centre text */}
            <text
              x="50"
              y="47"
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground text-[13px] font-bold"
            >
              {cardCount} / 100
            </text>
            <text
              x="50"
              y="59"
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-muted-foreground text-[8px]"
            >
              cards
            </text>
          </svg>

          {/* Mana-symbol row: colors the deck runs, plus colorless. */}
          <div className="flex items-center gap-3">
            {colors.map((key) => (
              <div key={key} className="flex flex-col items-center gap-0.5">
                <Image
                  src={MANA_SYMBOL_URL(key)}
                  alt={COLOR_NAMES[key] ?? key}
                  width={18}
                  height={18}
                  unoptimized
                  className="size-[1.125rem]"
                />
                <span className="text-[0.625rem] font-semibold tabular-nums text-muted-foreground">
                  {colorCounts[key]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-1">
          {rows.map((cat) => (
            <li key={cat} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: CAT_COLORS[cat] }}
              />
              <span className="text-muted-foreground">{cardCategoryLabel[cat]}</span>
              <span className="ml-auto font-semibold tabular-nums text-foreground">{composition[cat]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
