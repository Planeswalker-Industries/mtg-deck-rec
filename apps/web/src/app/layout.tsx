import type { Metadata, Viewport } from "next";
import { AdSlot } from "@/components/layout/ad-slot";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PasteLimitBubble } from "@/components/ui/paste-limit";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/constants";
import { SITE_URL } from "@/lib/site";
import { body, drama, heading, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description:
    "Commander deck recommendations built from the cards you already own. Import your collection, improve a deck, or swap into popular lists and skip the expensive singles.",
  // No title or description here: link previews fall back to each page's own <title> and description.
  openGraph: { siteName: SITE_NAME, type: "website", images: [DEFAULT_OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [DEFAULT_OG_IMAGE.url] },
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
