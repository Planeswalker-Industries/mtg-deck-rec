import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { Band } from "@/components/ui/band";
import { Panel } from "@/components/ui/panel";
import { SectionHeading } from "@/components/ui/section-heading";

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
 * the recording's own size can't stretch the frame. Lazy: the
 * recordings are megabytes and sit below the hero. A plain <picture>, since next/image can't pick a file by media
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
        className="size-full object-contain"
      />
    </picture>
  );
}

/**
 * The three steps, each showing the app at that step above the words. The steps are a real sequence, hence the
 * numbers and chevrons.
 */
export function HowItWorks() {
  return (
    <Band
      aria-labelledby="how-it-works"
      inner="grid gap-6 py-10 md:py-12 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10"
    >
      <div>
        <SectionHeading id="how-it-works" eyebrow="How it works">
          No more sifting through chaff
        </SectionHeading>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">{HOW_IT_WORKS_BLURB}</p>
      </div>
      <div role="list" className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-1.5">
        {STEPS.map(({ step, title, desc, media }, i) => (
          <Fragment key={step}>
            <Panel role="listitem" padding="none" surface="table" className="flex flex-1 flex-col overflow-hidden">
              {/* The recording is illustration; the heading and sentence below carry the meaning. */}
              <div aria-hidden className="relative aspect-[4/3] border-b border-seam bg-black/30">
                <StepRecording media={media} />
              </div>
              <div className="flex gap-2 px-4 py-3.5">
                <span aria-hidden className="text-[0.9375rem] leading-snug font-bold text-primary tabular-nums">
                  {step}.
                </span>
                <div>
                  <h3 className="text-[0.9375rem] leading-snug font-bold">{title}</h3>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </div>
            </Panel>
            {i < STEPS.length - 1 && (
              <div aria-hidden className="hidden shrink-0 items-center justify-center text-muted-foreground md:flex">
                <ChevronRight className="size-3.5" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </Band>
  );
}
