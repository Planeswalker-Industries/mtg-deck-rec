"use client"; // Error boundaries must be Client Components

import { ErrorPanel } from "@/components/layout/error-panel";
import { body, drama, heading, mono } from "./fonts";
import "./globals.css";

// Replaces the root layout when the layout itself throws, so it brings its own document, styles and fonts: the same
// font variables as the root layout, and globals.css for the paper tokens and the walnut table under the sheet.
export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable} ${drama.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <title>Something broke | Spell Chasm</title>
        <main className="page-column flex-1 pt-4 pb-10">
          <ErrorPanel {...props} />
        </main>
      </body>
    </html>
  );
}
