import type { ComponentPropsWithoutRef } from "react";
import { cn } from "cn";

/** A square-cornered sheet of cream paper on the table (the `sheet` utility, globals.css). */
export function Parchment({ className, ...rest }: ComponentPropsWithoutRef<"section">) {
  return <section className={cn("sheet", className)} {...rest} />;
}
