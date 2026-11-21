import type { ComponentPropsWithoutRef } from "react";
import { cn } from "cn";

/**
 * A page section on its own square-cornered sheet of cream paper on the table (the `sheet` utility, globals.css). Named
 * apart from `ui/sheet.tsx`, which is the drawer.
 */
export function SheetSection({ className, ...rest }: ComponentPropsWithoutRef<"section">) {
  return <section className={cn("sheet", className)} {...rest} />;
}
