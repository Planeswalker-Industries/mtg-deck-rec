import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "cn";

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
} as const;

type PanelProps<T extends ElementType> = {
  as?: T;
  padding?: keyof typeof PADDING;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

/**
 * A sheet of paper laid on the walnut table (the `sheet` utility, globals.css): square corners, a faint aged rim and a
 * soft shadow on the wood. Controls and tiles inside it keep their own modest rounding.
 */
export function Panel<T extends ElementType = "div">({ as, padding = "md", className, ...rest }: PanelProps<T>) {
  const Component: ElementType = as ?? "div";
  return <Component className={cn("sheet", PADDING[padding], className)} {...rest} />;
}
