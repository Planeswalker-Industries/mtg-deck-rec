"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface NavItem {
  href: "/deck" | "/rate" | "/decks" | "/collection";
  label: string;
  /** One line under the label in the phone menu, where there is room to say what the page is for. */
  hint: string;
  accountOnly: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/deck", label: "Upgrade a deck", hint: "Cards to cut, add and swap", accountOnly: false },
  { href: "/rate", label: "Rate cards", hint: "Vote on swaps other players suggest", accountOnly: false },
  { href: "/decks", label: "Your decks", hint: "The decks you have saved", accountOnly: true },
  { href: "/collection", label: "Your collection", hint: "The cards you own", accountOnly: true },
];

// Quiet until you reach for them: gold is the lamp, and it belongs on the one action that matters.
const NAV_LINK =
  "whitespace-nowrap rounded-md px-3 py-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-[current=page]:text-foreground";

const ICON_BUTTON =
  "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The header's links. Wide screens get them inline; below `lg` they fold into a menu that drops from the top, so the
 * account control (`children`) never gets pushed off a phone screen. Decks and collection only show when signed in.
 */
export function MainNav({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => signedIn || !item.accountOnly);

  return (
    <>
      <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={NAV_LINK}
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
      <Sheet>
        <SheetTrigger className={cn(ICON_BUTTON, "lg:hidden")} aria-label="Menu">
          <Menu aria-hidden className="size-5" />
        </SheetTrigger>
        <SheetContent side="top" showCloseButton={false} className="gap-0 border-seam bg-sleeve lg:hidden">
          <div className="flex h-14 items-center justify-between border-b border-seam px-4">
            <SheetTitle className="text-xl font-semibold">Menu</SheetTitle>
            <SheetDescription className="sr-only">Pages on MTG Deck Rec</SheetDescription>
            <SheetClose className={ICON_BUTTON} aria-label="Close menu">
              <X aria-hidden className="size-5" />
            </SheetClose>
          </div>
          <nav aria-label="Main" className="px-2 py-2">
            <ul>
              {items.map((item) => {
                const current = isCurrent(pathname, item.href);
                return (
                  <li key={item.href}>
                    <SheetClose asChild>
                      <Link
                        href={item.href}
                        aria-current={current ? "page" : undefined}
                        className="group flex items-center gap-3 rounded-md px-3 py-3 transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                      >
                        {/* The lamp from the logo marks the page you are on. */}
                        <span
                          aria-hidden
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            current
                              ? "bg-primary shadow-[0_0_10px_color-mix(in_oklch,var(--primary)_60%,transparent)]"
                              : "bg-seam",
                          )}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span
                            className={cn(
                              "font-heading text-xl leading-tight font-semibold",
                              current ? "text-foreground" : "text-foreground/85 group-hover:text-foreground",
                            )}
                          >
                            {item.label}
                          </span>
                          <span className="text-sm text-muted-foreground">{item.hint}</span>
                        </span>
                      </Link>
                    </SheetClose>
                  </li>
                );
              })}
            </ul>
            {!signedIn && (
              <p className="mt-1 border-t border-seam px-3 pt-3 pb-2 text-sm text-muted-foreground">
                <SheetClose asChild>
                  <Link href="/sign-in" className="font-bold text-primary underline-offset-4 hover:underline">
                    Sign in
                  </Link>
                </SheetClose>{" "}
                to save decks and keep your collection.
              </p>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
