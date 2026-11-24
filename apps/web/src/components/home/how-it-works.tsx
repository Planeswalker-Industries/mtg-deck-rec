"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { Coins, Crown, Shuffle } from "lucide-react";
import { cn } from "cn";
import { SheetSection } from "@/components/ui/sheet-section";

/** The clips' folder under `public`: each as WebM (VP9), MP4 (H.264) and a PNG still (owner, 2026-11-24). */
const CLIP_DIR = "/home";

interface StepClip {
  /** Muted and looping, offered as WebM first (smaller) and MP4 for browsers without it (iPhone Safari). */
  webm: string;
  mp4: string;
  /** What shows before it plays, and all that shows under reduced motion. Cropped to the clip's shape. */
  poster: string;
  width: number;
  height: number;
  /**
   * The frame's ground around a clip narrower than it: the paper the clip was recorded on, so the clip's edges melt into
   * the frame rather than sitting between dark bars.
   */
  matte: string;
}

/** Clip `n`'s three files. */
const clipFiles = (n: number) => ({
  webm: `${CLIP_DIR}/home_webm_${n}.webm`,
  mp4: `${CLIP_DIR}/home_mp4_${n}.mp4`,
  poster: `${CLIP_DIR}/home_png_${n}.png`,
});

/** The three tabs, each with its line and a recording of the app (the owner's clips, 2026-11-24). */
const TABS: { id: string; label: string; line: string; icon: typeof Crown; clip: StepClip }[] = [
  {
    id: "commander",
    label: "Choose any commander",
    line: "Any bracket. Any commander. Build more decks and buy fewer singles.",
    icon: Crown,
    clip: { ...clipFiles(1), width: 596, height: 500, matte: "paper-ground" },
  },
  {
    id: "budget",
    label: "Build it on a budget",
    line: "Sometimes a few more cards bring a deck together. Set a budget per card or per deck, so there are no surprises.",
    icon: Coins,
    clip: { ...clipFiles(2), width: 566, height: 468, matte: "paper-ground" },
  },
  {
    id: "tune",
    label: "Add, Cut, Swap & Share",
    line: "Start fresh or paste a decklist, and we'll take it to the next level without breaking the bank.",
    icon: Shuffle,
    clip: { ...clipFiles(3), width: 608, height: 564, matte: "bg-(--paper-raised)" },
  },
];

/**
 * One recording, contained (never cropped) in a frame shared by all three; absolute, so the recording's own size can't
 * stretch the frame. It plays only while it is on screen: a clip below the hero or in a `display: none` panel (a phone's
 * other tabs) loads nothing but its poster, and one scrolled away pauses. Under reduced motion it never plays: the
 * poster stands still.
 */
function StepRecording({ clip }: { clip: StepClip }) {
  const video = useRef<HTMLVideoElement>(null);
  const inView = useInView(video);
  const reduceMotion = useReducedMotion() ?? false;
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (!inView || reduceMotion) el.pause();
    // A browser that refuses to play (data saver) leaves the poster up.
    else void el.play().catch(() => undefined);
  }, [inView, reduceMotion]);
  return (
    <div className={cn("absolute inset-1 overflow-hidden rounded-sm", clip.matte)}>
      <video
        ref={video}
        poster={clip.poster}
        width={clip.width}
        height={clip.height}
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload="none"
        className="size-full object-contain"
      >
        <source src={clip.webm} type="video/webm" />
        <source src={clip.mp4} type="video/mp4" />
      </video>
    </div>
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
                <StepRecording clip={tab.clip} />
              </div>
            </div>
          );
        })}
      </div>
    </SheetSection>
  );
}
