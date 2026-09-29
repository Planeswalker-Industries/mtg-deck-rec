import type { ComponentPropsWithoutRef } from "react";
import { cn } from "cn";

/**
 * A full-width stripe of the page, closed by a rule that runs the whole window. The content inside stays in the
 * site's column, so it lines up with the header. Needs `overflow-x: clip` on html and body (globals.css), since 100vw
 * counts the scrollbar.
 *
 * `inner` styles the column (padding, grid); `className` the stripe itself.
 */
export function Band({
  className,
  inner,
  children,
  ...rest
}: ComponentPropsWithoutRef<"section"> & { inner?: string }) {
  return (
    <section className={cn("relative mx-[calc(50%-50vw)] w-screen border-b border-seam", className)} {...rest}>
      <div className={cn("mx-auto w-full max-w-6xl px-4", inner)}>{children}</div>
    </section>
  );
}
