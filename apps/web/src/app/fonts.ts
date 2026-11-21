import localFont from "next/font/local";

// Shared by the root layout and global-error, which renders its own document and must load the fonts itself.
// The fonts live in ./fonts (latin subsets, SIL OFL, licences beside them) rather than next/font/google:
// that one downloads them on every build, and a failed download fails the Vercel build.

// Body, buttons, labels and small headings (paper theme, picked 2026-11-20). No 600 exists, so semibold renders at 700.
export const body = localFont({
  src: [
    { path: "./fonts/alegreya-sans-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/alegreya-sans-700-latin.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

// Page and section headings: an old-style book serif. A variable font; the theme uses only 600 and 700.
export const heading = localFont({
  src: "./fonts/cormorant-garamond-latin.woff2",
  variable: "--font-heading-face",
  weight: "600 700",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

// The buddy's voice: the friend's asides. Italic only, one weight.
export const drama = localFont({
  src: "./fonts/newsreader-italic-latin.woff2",
  variable: "--font-drama-face",
  weight: "400",
  style: "italic",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

// Every number: deck counts, prices, mana value. No metric-matched fallback: next/font offers only Arial and Times.
export const mono = localFont({
  src: "./fonts/dm-mono-400-latin.woff2",
  variable: "--font-mono-face",
  weight: "400",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
});
