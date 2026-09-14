import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient } from "@/lib/server/supabase";

/**
 * Real 404s for card and commander pages. Those pages stream (Cache Components), so a slug they can't find would
 * otherwise return 200 with noindex. The check only asks whether the page's row exists, since neither page renders
 * without it; everything else, including database errors, is left to the page.
 */
export async function proxy(request: NextRequest) {
  const [, section, slug] = request.nextUrl.pathname.split("/");
  if ((section !== "card" && section !== "commander") || !slug) return NextResponse.next();

  try {
    if (!(await pageExists(section, decodeURIComponent(slug)))) {
      // Underscore folders are never routes, so this renders app/not-found.tsx with a 404 status.
      return NextResponse.rewrite(new URL("/_not-found", request.url));
    }
  } catch (err) {
    console.error(err);
  }
  return NextResponse.next();
}

async function pageExists(section: "card" | "commander", slug: string): Promise<boolean> {
  const db = createPublicClient();
  const { data, error } =
    section === "card"
      ? await db.from("cards").select("id").eq("slug", slug).is("deleted_at", null).limit(1)
      : await db.from("commander_keys").select("id").eq("slug", slug).limit(1);
  if (error) throw new Error(`Checking ${section} page ${slug} failed: ${error.message}`);
  return data.length > 0;
}

export const config = {
  matcher: ["/card/:slug", "/commander/:slug"],
};
