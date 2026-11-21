import Link from "next/link";
import { cn } from "cn";
import { PAGE_SHEET, SEAL_BUTTON, SEAL_OUTLINE_BUTTON } from "@/lib/constants";

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-heading" className={cn(PAGE_SHEET, "max-w-prose")}>
      <h1 id="not-found-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="text-muted-foreground">
        Nothing lives at this address. Check the spelling of the card or commander, or paste your decklist to get recommendations.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/deck" className={SEAL_BUTTON}>
          Upgrade a deck
        </Link>
        <Link href="/" className={SEAL_OUTLINE_BUTTON}>
          Home
        </Link>
      </div>
    </section>
  );
}
