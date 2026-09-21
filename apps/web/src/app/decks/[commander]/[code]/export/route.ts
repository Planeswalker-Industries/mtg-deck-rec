import { decklistCsv, decklistText, slugify } from "@mtg/core/parse";
import type { NextRequest } from "next/server";
import { isDeckExportFormat, type DeckExportFormat } from "@/lib/deck-export";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { deckExportEntriesWithPrintings } from "@/lib/server/deck-export";
import { loadDeckPage } from "@/lib/server/deck-page";

const CONTENT_TYPE: Record<DeckExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

/** Used when a deck name has no letters or digits left after slugging (a name of only emoji, say). */
const FALLBACK_FILE_NAME = "deck";

/**
 * A saved deck as a downloadable file: `?format=txt` (a decklist any site accepts on paste) or `?format=csv` (with
 * the printing the page shows for each card).
 *
 * Goes through the deck page's own loader, so exactly the people who can see the page can download it: its owner
 * always, everyone else only while it is public. A private or missing deck is a plain 404 either way, like the page.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/decks/[commander]/[code]/export">) {
  const format = request.nextUrl.searchParams.get("format");
  if (!isDeckExportFormat(format)) return new Response("Unknown export format.", { status: 400 });

  const { code } = await ctx.params;
  const db = await createAuthClient();
  const user = await getCurrentUser();
  const deck = await loadDeckPage(db, code, user?.id ?? null);
  if (!deck) return new Response("Deck not found.", { status: 404 });

  const entries = await deckExportEntriesWithPrintings(db, deck);
  const body = format === "csv" ? decklistCsv(entries) : decklistText(entries);
  // The file name comes from a user-written deck name, so only its slug goes into the header.
  const fileName = `${slugify(deck.name) || FALLBACK_FILE_NAME}.${format}`;

  return new Response(body, {
    headers: {
      "Content-Type": CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // A private deck's contents must never land in a shared cache.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
