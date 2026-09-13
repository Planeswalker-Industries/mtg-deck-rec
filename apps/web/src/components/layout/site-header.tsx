import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-seam bg-sleeve">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4">
        <Link
          href="/"
          className="font-heading text-2xl leading-none font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          MTG Deck Rec
        </Link>
        <nav aria-label="Main">
          <Link
            href="/deck"
            className="rounded-md px-3 py-2 text-sm font-bold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
          >
            Upgrade a deck
          </Link>
        </nav>
      </div>
    </header>
  );
}
