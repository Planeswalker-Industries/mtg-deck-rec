import Link from "next/link";

const NAV_LINK =
  "whitespace-nowrap rounded-md px-2 py-2 text-sm font-bold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary sm:px-3";

export function SiteHeader() {
  return (
    <header className="border-b border-seam bg-sleeve">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="whitespace-nowrap font-heading text-xl leading-none font-extrabold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:text-2xl"
        >
          MTG Deck Rec
        </Link>
        <nav aria-label="Main" className="flex items-center">
          <Link href="/collection" className={NAV_LINK}>
            <span className="sm:hidden">Collection</span>
            <span className="hidden sm:inline">My collection</span>
          </Link>
          <Link href="/deck" className={NAV_LINK}>
            Upgrade a deck
          </Link>
        </nav>
      </div>
    </header>
  );
}
