import type { ComponentPropsWithoutRef } from "react";
import { cn } from "cn";

/**
 * A page section as one sheet of paper the width of the site's column (the `sheet` utility, globals.css), with wood
 * showing between it and the next, as on the homepage. Sit it inside `page-column`.
 *
 * `inner` styles the sheet's content (padding, grid); `className` the sheet itself.
 */
export function Band({
  className,
  inner,
  children,
  ...rest
}: ComponentPropsWithoutRef<"section"> & { inner?: string }) {
  return (
    <section className={cn("sheet", className)} {...rest}>
      <div className={cn("px-5 py-6 sm:px-8 sm:py-8", inner)}>{children}</div>
    </section>
  );
}
