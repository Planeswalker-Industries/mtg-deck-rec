import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A section's name: an optional small ruled label in mono saying what kind of section it is, over the heading that says
 * what it is about. The label is a plain paragraph, so the page outline holds only the heading.
 */
export function SectionHeading({
  id,
  eyebrow,
  children,
  className,
  nowrap = false,
}: {
  id?: string;
  /** Keep the heading on one line; for short names in narrow columns. */
  nowrap?: boolean;
  /** The small label above the heading; none renders without it. */
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && (
        <p className="mb-2 flex items-center gap-2.5 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
          <span aria-hidden className="h-px w-5 shrink-0 bg-muted-foreground/60" />
          {eyebrow}
        </p>
      )}
      <h2
        id={id}
        className={cn(
          "font-heading text-2xl font-semibold tracking-tight",
          nowrap && "whitespace-nowrap",
        )}
      >
        {children}
      </h2>
    </div>
  );
}
