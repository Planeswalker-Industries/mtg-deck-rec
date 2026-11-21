import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A section heading set between two hand-ruled lines that end in arrowheads, like a cartographer's title. On a phone the
 * rules drop away and the heading centres alone.
 */
export function OrnateHeading({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-3 sm:gap-4", className)}>
      <Rule className="hidden sm:block" />
      <h2 id={id} className="text-center font-heading text-xl font-semibold text-balance sm:text-2xl">
        {children}
      </h2>
      <Rule className="hidden rotate-180 sm:block" />
    </div>
  );
}

function Rule({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 120 10" preserveAspectRatio="none" className={cn("h-2.5 min-w-8 flex-1", className)}>
      <path d="M0 5 H112 M104 1 L112 5 L104 9" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <circle cx="6" cy="5" r="1.6" fill="currentColor" />
    </svg>
  );
}
