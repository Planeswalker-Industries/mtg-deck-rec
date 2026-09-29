import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "cn";

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
} as const;

/** `sleeve` lifts the panel off the page; `table` keeps the page colour, so only the border marks it. */
const SURFACE = {
  sleeve: "bg-sleeve",
  table: "bg-background",
} as const;

type PanelProps<T extends ElementType> = {
  as?: T;
  padding?: keyof typeof PADDING;
  surface?: keyof typeof SURFACE;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

/**
 * A sleeve lying on the table: the one surface that sits above the page. Square-ish corners on purpose, so a panel
 * reads as a laid-down object rather than a floating card, and no shadow, since the light comes from above.
 */
export function Panel<T extends ElementType = "div">({
  as,
  padding = "md",
  surface = "sleeve",
  className,
  ...rest
}: PanelProps<T>) {
  const Component: ElementType = as ?? "div";
  return (
    <Component className={cn("rounded-md border border-seam", SURFACE[surface], PADDING[padding], className)} {...rest} />
  );
}
