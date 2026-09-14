import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-heading" className="flex max-w-prose flex-col gap-4 py-8">
      <h1 id="not-found-heading" className="font-heading text-4xl leading-none font-extrabold tracking-tight">
        Page not found
      </h1>
      <p className="text-muted-foreground">
        Nothing lives at this address. Check the spelling of the card or commander, or paste your decklist to get
        recommendations.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/deck" className={buttonVariants({ size: "lg" })}>
          Upgrade a deck
        </Link>
        <Link href="/" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Home
        </Link>
      </div>
    </section>
  );
}
