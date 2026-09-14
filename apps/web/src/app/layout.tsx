import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Sofia_Sans_Condensed } from "next/font/google";
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

// Condensed display face for headings and long card names.
const display = Sofia_Sans_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MTG Deck Rec", template: "%s | MTG Deck Rec" },
  description:
    "Commander deck recommendations: cards to cut, cards to add, and replacements that do the same job, with card images and price differences.",
};

export const viewport: Viewport = {
  themeColor: "#e9eef3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <AdSlot slot="leaderboard" />
        <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 pt-4 pb-10">
          <main className="min-w-0 flex-1">{children}</main>
          <AdSlot slot="rail" />
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
