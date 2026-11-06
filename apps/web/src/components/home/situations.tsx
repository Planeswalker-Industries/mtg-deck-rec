import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { BUILD_DECK_HREF } from "@/lib/constants";

/**
 * The two ways in, as the site's own buttons so they read as pressable. A commander opens the deck tool's commander
 * picker, which builds a deck for it; a decklist opens the deck tool to paste one.
 */
const STARTS: { label: string; href: Route; variant: "default" | "outline" }[] = [
  { label: "Choose Commander", href: BUILD_DECK_HREF as Route, variant: "default" },
  { label: "Improve Decklist", href: "/deck", variant: "outline" },
];

/** A thin ribbon across the page: the prompt, then the starting points. On a phone the buttons share one row. */
export function Situations() {
  return (
    <section aria-labelledby="situations" className="relative mx-[calc(50%-50vw)] w-screen border-b border-seam">
      <div className="page-column flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-6">
        <div>
          <h2 id="situations" className="font-heading text-xl font-semibold tracking-tight">
            Start here
          </h2>
          <p className="text-sm text-muted-foreground">Choose your path.</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:flex">
          {STARTS.map((s) => (
            <li key={s.label}>
              <Button asChild size="lg" variant={s.variant} className={cn("h-12 w-full px-3 text-base sm:px-6 font-semibold sm:w-auto", s.variant === "default" && "lit")}>
                <Link href={s.href}>{s.label}</Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
