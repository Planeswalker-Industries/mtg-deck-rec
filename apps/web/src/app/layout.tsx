import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AdSlot } from "@/components/layout/ad-slot";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { impactLoaderScript } from "@/lib/affiliate";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// The fonts live in ./fonts (Google Fonts' latin subsets, SIL OFL, licences beside them) rather than next/font/google:
// that one downloads them on every build, and a failed download fails the Vercel build.

// Headings, body, buttons: warm and slightly hand-made. A variable font; the lane uses only its 400 and 600 weights.
const body = localFont({
  src: "./fonts/bricolage-grotesque-latin.woff2",
  variable: "--font-body",
  weight: "400 600",
  style: "normal",
  display: "swap",
});

// The buddy's voice: the friend's asides. Italic only, one weight.
const drama = localFont({
  src: "./fonts/newsreader-italic-latin.woff2",
  variable: "--font-drama-face",
  weight: "400",
  style: "italic",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

// Every number: deck counts, prices, mana value. No metric-matched fallback: next/font offers only Arial and Times.
const mono = localFont({
  src: "./fonts/dm-mono-400-latin.woff2",
  variable: "--font-mono-face",
  weight: "400",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MTG Deck Rec", template: "%s | MTG Deck Rec" },
  description:
    "Commander deck recommendations built from the cards you already own. Import your collection, improve a deck, or swap into popular lists and skip the expensive singles.",
};

export const viewport: Viewport = {
  themeColor: "#0c1015",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const affiliateScript = impactLoaderScript();
  return (
    <html lang="en" className={`dark ${body.variable} ${drama.variable} ${mono.variable} h-full`}>
      <head>
        {/* A plain tag, not next/script: Next queues an inline beforeInteractive script at the end of <body>. The
            loader only queues calls and adds an async script, so it doesn't block rendering. Its content is built
            from a validated id only (lib/affiliate.ts). */}
        {affiliateScript && <script id="impact-affiliate" dangerouslySetInnerHTML={{ __html: affiliateScript }} />}
      </head>
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
