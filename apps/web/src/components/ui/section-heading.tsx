import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A section's name, marked by the short gold rule the page uses for every section. Sentence case in the display
 * face: the rule is the device, so the words don't need to shout.
 */
export function SectionHeading({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <h2
      id={id}
      className={cn("flex items-center gap-3 font-heading text-2xl leading-tight font-semibold sm:text-[1.75rem]", className)}
    >
      <span aria-hidden className="h-0.5 w-6 shrink-0 bg-primary" />
      {children}
    </h2>
  );
}
