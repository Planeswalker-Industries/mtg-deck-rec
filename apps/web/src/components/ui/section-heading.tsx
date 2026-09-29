import type { ReactNode } from "react";

/**
 * A section's name: a small gold-ruled label saying what kind of section it is, over the heading that says what it is
 * about. The label is a plain paragraph, so the page outline holds only the heading.
 */
export function SectionHeading({
  id,
  eyebrow,
  children,
  className,
}: {
  id?: string;
  /** The small label above the heading. */
  eyebrow: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="flex items-center gap-2.5 text-[0.6875rem] font-bold tracking-[0.2em] text-primary uppercase">
        <span aria-hidden className="h-0.5 w-5 shrink-0 bg-primary" />
        {eyebrow}
      </p>
      <h2 id={id} className="mt-2 font-heading text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.01em]">
        {children}
      </h2>
    </div>
  );
}
