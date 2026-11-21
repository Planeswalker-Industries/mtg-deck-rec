import type { Metadata, Viewport } from "next";
import { AdSlot } from "@/components/layout/ad-slot";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PasteLimitBubble } from "@/components/ui/paste-limit";
import { SITE_URL } from "@/lib/site";
import { body, drama, heading, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Spell Chasm", template: "%s | Spell Chasm" },
  description:
    "Commander deck recommendations built from the cards you already own. Import your collection, improve a deck, or swap into popular lists and skip the expensive singles.",
};

// The browser chrome matches the dark bar over the wood (onyx 950, globals.css --wood-bar).
const THEME_COLOR = "#131111";

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${drama.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <AdSlot slot="leaderboard" />
        <div className="page-column flex flex-1 gap-6 pt-4 pb-10">
          <main className="min-w-0 flex-1">{children}</main>
          <AdSlot slot="rail" />
        </div>
        <SiteFooter />
        <PasteLimitBubble />
      </body>
    </html>
  );
}
