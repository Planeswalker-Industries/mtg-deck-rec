"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Coins, Crown, Shuffle } from "lucide-react";
import { cn } from "cn";
import { SheetSection } from "@/components/ui/sheet-section";

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
 * The three tabs, each with its line and a recording of the app. The recordings are placeholders until the owner
 * replaces them (2026-11-20).
 */
const TABS: { id: string; label: string; line: string; icon: typeof Crown; media: StepMedia }[] = [
  {
    id: "commander",
    label: "Choose any commander",
    line: "Any bracket. Any commander. Build more decks and buy fewer singles.",
    icon: Crown,
    media: { src: "/add.png", width: 427, height: 333 },
  },
  {
    id: "budget",
    label: "Build it on a budget",
    line: "Sometimes a few more cards bring a deck together. Set a budget per card or per deck, so there are no surprises.",
    icon: Coins,
    media: { src: "/cut_gif.gif", hiSrc: "/cut_gif_hi.gif", width: 566, height: 346 },
  },
  {
    id: "tune",
    label: "Add, Cut, Swap & Share",
    line: "Start fresh or paste a decklist, and we'll take it to the next level without breaking the bank.",
    icon: Shuffle,
    media: { src: "/swipe_gif.gif", hiSrc: "/swipe_gif_hi.gif", width: 374, height: 378 },
  },
];

/**
 * One recording, contained (never cropped) in a frame shared by all three; absolute, so the recording's own size can't
 * stretch the frame. Lazy: the recordings are megabytes and sit below the hero, and one inside a `display: none` panel
 * never loads at all. A plain <picture>, since next/image can't pick a file by media query and does not optimise GIFs.
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

/**
 * The three things Spell Chasm does, as a tabber on one sheet. On a phone each tab reveals its line and recording
 * beneath, one at a time. From `md` all three panels sit in a row under their tabs, and the selected tab highlights its
 * own. Arrow keys move between tabs.
 */
export function HowItWorks() {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (selected + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <SheetSection aria-label="How it works" className="overflow-hidden">
      <div
        role="tablist"
        aria-label="How it works"
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 divide-x divide-[color-mix(in_oklch,var(--ink)_30%,transparent)] border-b border-[color-mix(in_oklch,var(--ink)_25%,transparent)]"
      >
        {TABS.map((tab, i) => {
          const on = i === selected;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`panel-${tab.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setSelected(i)}
              className={cn(
                "relative flex min-h-11 flex-col items-center justify-center gap-1.5 px-2 py-4 text-center transition-colors sm:flex-row sm:gap-3",
                "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--primary)]",
                // The selected tab: espresso ink, a slightly lighter patch of paper and a thick bar along its foot.
                on
                  ? "bg-(--paper-raised)/70 text-[var(--primary)] after:absolute after:inset-x-0 after:-bottom-px after:h-1 after:bg-[var(--primary)]"
                  : "text-[var(--ink)] hover:bg-(--paper-raised)/40",
              )}
            >
              <tab.icon
                aria-hidden
                className={cn("size-6 shrink-0", on ? "text-[var(--primary)]" : "text-[var(--brass)]")}
                strokeWidth={1.5}
              />
              <span className={cn("text-sm leading-snug sm:text-base", on && "font-semibold")}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 px-5 py-6 sm:px-8 md:grid-cols-3 md:gap-8 md:py-8">
        {TABS.map((tab, i) => {
          const on = i === selected;
          return (
            <div
              key={tab.id}
              id={`panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
              className={cn(
                "flex flex-col gap-4 transition-opacity duration-200",
                on ? "opacity-100" : "max-md:hidden md:opacity-55 md:hover:opacity-80",
              )}
            >
              <p className="text-base text-[var(--ink-soft)]">{tab.line}</p>
              {/* The recording is illustration; the tab and its line carry the meaning. */}
              <div
                aria-hidden
                className={cn(
                  "relative mt-auto aspect-[5/4] rounded-md border-2 bg-(--wood-bar) shadow-[0_10px_18px_-10px_color-mix(in_srgb,var(--wood-bar)_90%,transparent)] transition-colors",
                  on ? "border-[var(--primary)]" : "border-[var(--brass)]",
                  i % 2 === 1 ? "rotate-[1.2deg]" : "-rotate-[1deg]",
                )}
              >
                <StepRecording media={tab.media} />
              </div>
            </div>
          );
        })}
      </div>
    </SheetSection>
  );
}
