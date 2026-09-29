import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Band } from "@/components/ui/band";
import { Panel } from "@/components/ui/panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { StepsCarousel } from "./steps-carousel";

const HOW_IT_WORKS_HEADING = "Go through your deck like a friend would";

/** Beside the steps: the three passes, told with the cards a real Liesa deck runs into. */
const HOW_IT_WORKS_BLURB =
  "We go through your list card by card. A stray Lightning Bolt in an Orzhov deck comes out, the slots fill with what Liesa decks actually play, and the Smuggler's Share in your binder stands in for the Smothering Tithe you'd have to buy.";

/** Wide screens get the higher-quality file; the recordings share one pixel size, so it is the colours that differ. */
const HI_RES_MEDIA = "(min-width: 1024px)";

interface StepMedia {
  /** Phones and small screens. */
  src: string;
  /** Wide screens, where the step cards are large enough to show the extra quality. */
  hiSrc?: string;
  width: number;
  height: number;
}

/** Recordings of the app itself, one per step, so each step shows the screen it describes. */
/**
 * The three steps of the deck tool, each titled by its verb in capitals and the job's own colour (as in the tool's
 * stepper) and shown with the recording of that step. Capitals come from CSS, so a screen reader says "cut", not
 * "C-U-T".
 */
const STEPS: { step: number; verb: string; rest: string; tone: string; desc: string; media: StepMedia }[] = [
  {
    step: 1,
    verb: "Cut",
    rest: "the junk",
    tone: "text-cut",
    desc: "Banned cards, strays outside your colors and the clunkers your commander's decks never run. Swipe to cut or keep.",
    media: { src: "/cut_gif.gif", hiSrc: "/cut_gif_hi.gif", width: 566, height: 346 },
  },
  {
    step: 2,
    verb: "Add",
    rest: "what works",
    tone: "text-add",
    desc: "Fill the open slots with the ramp, draw and removal that decks with your commander actually play.",
    media: { src: "/add.png", width: 427, height: 333 },
  },
  {
    step: 3,
    verb: "Swap",
    rest: "in your collection",
    tone: "text-replace",
    desc: "Trade expensive singles for cards that do the same job and are already in your binder.",
    media: { src: "/swipe_gif.gif", hiSrc: "/swipe_gif_hi.gif", width: 374, height: 378 },
  },
];

/**
 * One step's recording, contained (never cropped) in a frame shared by all three so the cards line up; absolute, so
 * the recording's own size can't stretch the frame. Lazy: the recordings are megabytes and sit below the hero, and a
 * copy inside a `display: none` layout never loads at all. A plain <picture>, since next/image can't pick a file by media
 * query and does not optimise GIFs anyway.
 */
function StepRecording({ media }: { media: StepMedia }) {
  return (
    <picture className="absolute inset-1">
      {media.hiSrc && <source media={HI_RES_MEDIA} srcSet={media.hiSrc} />}
      <img
        src={media.src}
        alt=""
        width={media.width}
        height={media.height}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="size-full object-contain"
      />
    </picture>
  );
}

type Step = (typeof STEPS)[number];

/**
 * One step: its number, title and sentence, and the recording. `textFirst` puts the words above the recording (the
 * phone carousel, where the title says which step you have swiped to); otherwise the recording leads.
 */
function StepCard({
  step,
  textFirst = false,
  className,
  role,
}: {
  step: Step;
  textFirst?: boolean;
  className?: string;
  role?: string;
}) {
  const text = (
    <div className="flex gap-2 px-4 py-3.5">
      <span aria-hidden className="font-mono text-base leading-snug text-muted-foreground">
        {step.step}.
      </span>
      <div>
        <h3 className="text-base leading-snug font-semibold">
          <span className={cn("uppercase", step.tone)}>{step.verb}</span> {step.rest}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
      </div>
    </div>
  );
  // The recording is illustration; the heading and sentence carry the meaning.
  const recording = (
    <div
      aria-hidden
      className={cn("relative aspect-[4/3] border-seam bg-black/30", textFirst ? "mt-auto border-t" : "border-b")}
    >
      <StepRecording media={step.media} />
    </div>
  );
  return (
    <Panel role={role} padding="none" surface="sleeve" className={cn("flex flex-col overflow-hidden", className)}>
      {textFirst ? text : recording}
      {textFirst ? recording : text}
    </Panel>
  );
}

/**
 * The three steps, each showing the app at that step. The steps are a real sequence, hence the numbers and chevrons.
 * Wide screens lay them in a row; phones get a swipeable carousel with the words on top. Only one of the two is
 * displayed, so assistive tech and the page's images see one set.
 */
export function HowItWorks() {
  return (
    <Band
      aria-labelledby="how-it-works"
      inner="grid grid-cols-[minmax(0,1fr)] gap-6 py-12 md:py-16 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12"
    >
      <div>
        <SectionHeading id="how-it-works" eyebrow="How it works">
          {HOW_IT_WORKS_HEADING}
        </SectionHeading>
        <p className="mt-4 max-w-prose text-base text-muted-foreground">{HOW_IT_WORKS_BLURB}</p>
      </div>

      <div className="md:hidden">
        <StepsCarousel labels={STEPS.map((step) => `Step ${step.step}: ${step.verb} ${step.rest}`)}>
          {STEPS.map((step) => (
            <StepCard key={step.step} step={step} textFirst className="h-full" />
          ))}
        </StepsCarousel>
      </div>

      <div role="list" className="hidden md:flex md:flex-row md:items-stretch md:gap-1.5">
        {STEPS.map((step, i) => (
          <Fragment key={step.step}>
            <StepCard step={step} className="flex-1" role="listitem" />
            {i < STEPS.length - 1 && (
              <div aria-hidden className="flex shrink-0 items-center justify-center text-muted-foreground">
                <ChevronRight className="size-3.5" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </Band>
  );
}
