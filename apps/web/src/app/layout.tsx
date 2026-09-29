import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Mono, Newsreader } from "next/font/google";
import { AdSlot } from "@/components/layout/ad-slot";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Headings, body, buttons: warm and slightly hand-made. Only 400 and 600 are loaded, the lane's two weights.
const body = Bricolage_Grotesque({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

// The buddy's voice: the friend's asides. Italic only, one weight.
const drama = Newsreader({
  variable: "--font-drama-face",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  display: "swap",
});

// Every number: deck counts, prices, mana value.
const mono = DM_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MTG Deck Rec", template: "%s | MTG Deck Rec" },
  description:
    "Commander deck recommendations built from the cards you already own. Import your collection, improve a deck, or swap into popular lists and skip the expensive singles.",
};

export const viewport: Viewport = {
  themeColor: "#1b1510",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${body.variable} ${drama.variable} ${mono.variable} h-full`}>
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
