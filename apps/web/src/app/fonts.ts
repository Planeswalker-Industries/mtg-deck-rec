import localFont from "next/font/local";

// Shared by the root layout and global-error, which renders its own document and must load the fonts itself.
// The fonts live in ./fonts (Google Fonts' latin subsets, SIL OFL, licences beside them) rather than next/font/google:
// that one downloads them on every build, and a failed download fails the Vercel build.

// Headings, body, buttons: warm and slightly hand-made. A variable font; the lane uses only its 400 and 600 weights.
export const body = localFont({
  src: "./fonts/bricolage-grotesque-latin.woff2",
  variable: "--font-body",
  weight: "400 600",
  style: "normal",
  display: "swap",
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
