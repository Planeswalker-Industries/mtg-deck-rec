import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { sampleCard } from "@/lib/sample-cards";

/** A hand fanned out on the table, commander in the middle and lit from above. */
type FanCard = {
  card: CardSummary;
  rotate: number;
  x: string;
  y: string;
  scale: number;
  /** Hidden on phones, where only the middle three fit. */
  wide?: boolean;
};

const FAN: FanCard[] = [
  {
    card: sampleCard("Cultivate"),
    rotate: -22,
    x: "-64%",
    y: "10%",
    scale: 0.86,
    wide: true,
  },
  {
    card: sampleCard("Rhystic Study"),
    rotate: -11,
    x: "-33%",
    y: "3%",
    scale: 0.93,
  },
  {
    card: sampleCard("Chulane, Teller of Tales"),
    rotate: 0,
    x: "0%",
    y: "-4%",
    scale: 1,
  },
  {
    card: sampleCard("Counterspell"),
    rotate: 11,
    x: "33%",
    y: "3%",
    scale: 0.93,
  },
  {
    card: sampleCard("Birds of Paradise"),
    rotate: 22,
    x: "64%",
    y: "10%",
    scale: 0.86,
    wide: true,
  },
];
const FAN_SIZES = "(min-width: 768px) 240px, 42vw";
/** The middle card: every other card's stacking and deal delay counts outward from it. */
const FAN_MIDDLE = Math.floor(FAN.length / 2);
/** The middle card lands first, then each pair outward this much later. */
const DEAL_BASE_MS = 60;
const DEAL_STEP_MS = 90;
const FAN_TOP_Z = 10;

/** The hero's card fan, dealt once on load (`.fan-card` in globals.css). Decorative: the headline says what it is. */
export function HeroFan() {
  return (
    <div aria-hidden className="w-full">
      <div className="relative mx-auto h-[14rem] w-[9.5rem] sm:h-[16rem] sm:w-[9rem] md:h-[17rem] md:w-[12rem] lg:h-[21rem] lg:w-[15rem]">
        {FAN.map((pocket, i) => (
          <div
            key={pocket.card.name}
            className={`fan-card absolute inset-0 ${pocket.wide ? "hidden sm:block" : ""}`}
            style={
              {
                "--r": `${pocket.rotate}deg`,
                "--x": pocket.x,
                "--y": pocket.y,
                "--s": pocket.scale,
                "--delay": `${DEAL_BASE_MS + Math.abs(i - FAN_MIDDLE) * DEAL_STEP_MS}ms`,
                zIndex: FAN_TOP_Z - Math.abs(i - FAN_MIDDLE),
              } as React.CSSProperties
            }
          >
            <CardImage
              card={pocket.card}
              alt=""
              sizes={FAN_SIZES}
              eager
              className="shadow-[0_18px_40px_-16px_rgb(0_0_0/0.9)]"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
