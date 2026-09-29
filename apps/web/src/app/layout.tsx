import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Faustina } from "next/font/google";
import { AdSlot } from "@/components/layout/ad-slot";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Legible at small sizes: card names and badges on phones.
const body = Atkinson_Hyperlegible_Next({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  // next/font has no metric overrides for this family, so use a plain system fallback.
  adjustFontFallback: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

// Headings are set in Faustina Bold: a sturdy serif, heavy enough to hold its own over the land art (ExtraBold read
// too heavy). Only the 700 weight is loaded, so every heading renders Bold whatever weight class it carries.
const display = Faustina({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "700",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MTG Deck Rec", template: "%s | MTG Deck Rec" },
  description:
    "Commander deck recommendations built from the cards you already own. Import your collection, improve a deck, or swap into popular lists and skip the expensive singles.",
};

export const viewport: Viewport = {
  themeColor: "#080e15",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${body.variable} ${display.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <AdSlot slot="leaderboard" />
        <div className="page-column flex flex-1 gap-6 pt-4 pb-10">
          <main className="min-w-0 flex-1">{children}</main>
          <AdSlot slot="rail" />
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
