"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";
import { cn } from "cn";

/**
 * Where players start from, in their own words, and what to bring. Each cell turns over on hover (or keyboard focus)
 * to show the action, marked with the deck tool's Add symbol, and is a link to it. A commander starts in the deck tool
 * too, pasted on its own.
 */
const SITUATIONS: { said: string; action: string; href: Route }[] = [
  { said: "Found a great deck online!", action: "Decklist", href: "/deck" },
  { said: "Just pulled a cool new Commander!", action: "Commander", href: "/deck" },
  { said: "How do I improve my deck?", action: "Decklist", href: "/deck" },
  { said: "Just want a frame to build from", action: "Collection", href: "/collection/import" },
];

/** Both faces fill the same cell, so the cell is as tall as its taller face and the turn never jumps. */
const FACE = "flex items-center justify-center px-4 text-center backface-hidden [grid-area:1/1]";

/**
 * One cell of the ribbon. A mouse or keyboard focus turns it over (CSS, after a short pause so passing across the row
 * doesn't set every cell spinning); a click goes straight to the action. Touch has no hover, so the first tap turns
 * it over and the second follows the link.
 */
function SituationCell({ said, action, href, className }: (typeof SITUATIONS)[number] & { className?: string }) {
  const [tapped, setTapped] = useState(false);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
    if (touch && !tapped) {
      e.preventDefault();
      setTapped(true);
    }
  };

  return (
    <li className={cn("perspective-distant", className)}>
      <Link
        href={href}
        aria-label={`${said} Add your ${action.toLowerCase()}`}
        onClick={onClick}
        onBlur={() => setTapped(false)}
        className="group block h-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span
          className={cn(
            "grid h-full min-h-20 grid-cols-[minmax(0,1fr)] transition-transform duration-450 ease-table transform-3d motion-reduce:transition-none",
            "group-hover:rotate-y-180 group-hover:[transition-delay:150ms] group-focus-visible:rotate-y-180",
            tapped && "rotate-y-180",
          )}
        >
          <span aria-hidden className={cn(FACE, "font-drama text-lg text-balance text-foreground italic")}>
            &ldquo;{said}&rdquo;
          </span>
          <span aria-hidden className={cn(FACE, "rotate-y-180 gap-1.5 bg-muted text-base font-semibold text-primary")}>
            <Plus className="size-5 shrink-0" strokeWidth={2.5} />
            {action}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * A thin ribbon across the page: the prompt, then the four starting points, divided by single rules. Five across on
 * wide screens; on a phone the prompt takes the top row and the four sit two by two.
 */
export function Situations() {
  return (
    <section aria-labelledby="situations" className="relative mx-[calc(50%-50vw)] w-screen border-b border-seam">
      <ul className="page-column grid grid-cols-2 lg:grid-cols-5">
        <li className="col-span-2 flex flex-col justify-center py-4 lg:col-span-1 lg:py-0 lg:pr-4">
          <h2 id="situations" className="font-heading text-xl font-semibold tracking-tight">
            Sound familiar?
          </h2>
          <p className="text-sm text-muted-foreground">Choose where to start.</p>
        </li>
        {SITUATIONS.map((s, i) => (
          <SituationCell
            key={s.said}
            {...s}
            className={cn(
              "border-seam max-lg:border-t",
              i % 2 === 0 ? "max-lg:border-r" : "",
              "lg:border-l",
              i === SITUATIONS.length - 1 && "lg:border-r",
            )}
          />
        ))}
      </ul>
    </section>
  );
}
