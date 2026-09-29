import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Band } from "@/components/ui/band";
import { Panel } from "@/components/ui/panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { StepsCarousel } from "./steps-carousel";

const HOW_IT_WORKS_BLURB =
  "It's exhausting scrolling sites like Moxfield and EDHREC, seeing awesome decks and being unsure what to swap in where. Whether you want to tune up your own deck, build a netdeck from the cards you already own, or have us assemble a starting point around the cool legendary you just pulled, we've got you covered.";

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
const STEPS: { step: number; title: string; desc: string; media: StepMedia }[] = [
  {
    step: 1,
    title: "Import your collection",
    desc: "Via text, CSV, or from the most popular web apps.",
    media: { src: "/add.png", width: 427, height: 333 },
  },
  {
    step: 2,
    title: "Add your decklist",
    desc: "Either your own or from your favorite site.",
    media: { src: "/cut_gif.gif", hiSrc: "/cut_gif_hi.gif", width: 566, height: 346 },
  },
  {
    step: 3,
    title: "Cut/Add/Replace",
    desc: "Tailored recommendations to swap out expensive cards or improve your existing deck with the cards you already own.",
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
        <h3 className="text-base leading-snug font-semibold">{step.title}</h3>
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
          No more sifting through chaff
        </SectionHeading>
        <p className="mt-4 max-w-prose text-base text-muted-foreground">{HOW_IT_WORKS_BLURB}</p>
      </div>

      <div className="md:hidden">
        <StepsCarousel labels={STEPS.map((step) => `Step ${step.step}: ${step.title}`)}>
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
