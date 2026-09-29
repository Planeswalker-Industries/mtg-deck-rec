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
const DEAL_STEP_MS = 80;
/** One card's deal; matches `.fan-card` in globals.css. */
const DEAL_DURATION_MS = 350;
const FAN_TOP_Z = 10;

/**
 * The pass: one card slid across the table onto the hand, the lane's signature moment. It lands after the deal, on
 * top of the fan's lower right.
 */
const PASSED_CARD = sampleCard("Three Visits");
/** Lands once the last pair of fan cards is down. */
const PASS_DELAY_MS = DEAL_BASE_MS + FAN_MIDDLE * DEAL_STEP_MS + DEAL_DURATION_MS;
const PASS_ROTATE_DEG = -7;
const PASS_X = "58%";
const PASS_Y = "18%";
const PASS_SCALE = 0.78;

/**
 * The hero's card fan, dealt once on load (`.fan-card` in globals.css), then one card passed onto it (`.pass-card`).
 * Decorative: the headline says what it is.
 */
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
              className="shadow-lift"
            />
          </div>
        ))}
        <div
          className="pass-card absolute inset-0"
          style={
            {
              "--r": `${PASS_ROTATE_DEG}deg`,
              "--x": PASS_X,
              "--y": PASS_Y,
              "--s": PASS_SCALE,
              "--delay": `${PASS_DELAY_MS}ms`,
              zIndex: FAN_TOP_Z + 1,
            } as React.CSSProperties
          }
        >
          <CardImage card={PASSED_CARD} alt="" sizes={FAN_SIZES} eager className="shadow-lift" />
        </div>
      </div>
    </div>
  );
}
