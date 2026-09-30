import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Band } from "@/components/ui/band";
import { Panel } from "@/components/ui/panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { StepsCarousel } from "./steps-carousel";

const HOW_IT_WORKS_HEADING = "No more singles!";

/** Beside the steps: who it is for and the three ways in, the same three the "Sound familiar?" ribbon offers. */
const HOW_IT_WORKS_BLURB =
  "If you're sick of overpriced decklists and just want to build your best deck with the cards you've got, it's as easy as pasting a decklist, choosing a commander, or uploading your collection.";

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

/**
 * The three steps of the deck tool, each a recording of the app at that step with its verb as a caption: capitals and
 * the job's own colour, as in the tool's stepper. Capitals come from CSS, so a screen reader says "cut", not "C-U-T".
 */
const STEPS: { step: number; verb: string; rest: string; tone: string; media: StepMedia }[] = [
  {
    step: 1,
    verb: "Cut",
    rest: "the junk",
    tone: "text-cut",
    media: { src: "/cut_gif.gif", hiSrc: "/cut_gif_hi.gif", width: 566, height: 346 },
  },
  {
    step: 2,
    verb: "Add",
    rest: "what works",
    tone: "text-add",
    media: { src: "/add.png", width: 427, height: 333 },
  },
  {
    step: 3,
    verb: "Swap",
    rest: "in your collection",
    tone: "text-replace",
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
 * One step: the recording, with the step's title as a slim caption along its foot (about a tenth of the card). No
 * edge of its own; the rounded corners come from the panel clipping the recording and caption.
 */
function StepCard({ step, className, role }: { step: Step; className?: string; role?: string }) {
  return (
    <Panel role={role} padding="none" surface="sleeve" className={cn("@container flex flex-col overflow-hidden border-transparent", className)}>
      {/* The recording is illustration; the caption carries the meaning. */}
      <div aria-hidden className="relative aspect-[5/4] bg-black/30">
        <StepRecording media={step.media} />
      </div>
      {/* Always one line, centred in whatever height the card is given, so no card grows a gap under its caption. The
          size of the "Sound familiar?" heading where the card has room for "SWAP in your collection", a step or two
          down the scale where it doesn't (the three cards are always the same width, so they always match). */}
      <h3 className="flex min-w-0 flex-1 items-center justify-center px-2 py-2 font-heading text-base leading-tight font-semibold tracking-tight @[14rem]:text-lg @[18rem]:px-3 @[18rem]:text-xl">
        <span className="truncate">
          <span className={cn("uppercase", step.tone)}>{step.verb}</span> {step.rest}
        </span>
      </h3>
    </Panel>
  );
}

/**
 * The three steps, each showing the app at that step. The steps are a real sequence, hence the chevrons. Wide
 * screens lay them in a row; phones get a swipeable carousel. Only one of the two is displayed, so assistive tech and
 * the page's images see one set.
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
            <StepCard key={step.step} step={step} className="h-full" />
          ))}
        </StepsCarousel>
      </div>

      <div role="list" className="hidden md:flex md:flex-row md:items-stretch md:gap-1.5 md:self-start">
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
