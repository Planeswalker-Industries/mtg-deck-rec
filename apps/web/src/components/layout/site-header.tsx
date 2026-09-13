import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="font-heading font-semibold tracking-tight">
          MTG Deck Rec
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/deck" className="hover:text-foreground">
            Deck tool
          </Link>
        </nav>
      </div>
    </header>
  );
}
