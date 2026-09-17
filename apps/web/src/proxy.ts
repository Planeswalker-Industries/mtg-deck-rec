import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/server/database.types";
import { createPublicClient } from "@/lib/server/supabase";

/**
 * Runs before pages and route handlers:
 * - Real 404s for card and commander pages. Those pages stream (Cache Components), so a slug they can't find would
 *   otherwise return 200 with noindex. The check only asks whether the page's row exists; database errors are left to
 *   the page.
 * - Keeps a signed-in visitor's session fresh. Server Components can't write cookies, so an expired access token is
 *   refreshed here. Visitors without a session cookie skip this entirely.
 */
export async function proxy(request: NextRequest) {
  const [, section, slug] = request.nextUrl.pathname.split("/");

  // A deck page a signed-out visitor cannot see should be a real 404, not a 200 with an empty shell, so its id
  // cannot be probed. Only for signed-out visitors: the anon client cannot tell a private deck from a missing one,
  // and an owner has every right to their own hidden deck. A signed-in visitor falls through to the page, which
  // renders the not-found body without leaking anything.
  const code = request.nextUrl.pathname.split("/")[3];
  if (section === "decks" && code && DECK_CODE.test(code) && !hasSessionCookie(request)) {
    try {
      if (!(await publicDeckExists(code))) {
        return NextResponse.rewrite(new URL("/_missing", request.url));
      }
    } catch (err) {
      console.error(err);
    }
  }

  if ((section === "card" || section === "commander") && slug) {
    try {
      if (!(await pageExists(section, decodeURIComponent(slug)))) {
        // A path no route matches renders app/not-found.tsx with a 404 status. Not /_not-found itself: Vercel serves that
        // prerendered page with 200. Underscore folders are private in the app router, so /_missing never becomes a route.
        return NextResponse.rewrite(new URL("/_missing", request.url));
      }
    } catch (err) {
      console.error(err);
    }
  }

  return hasSessionCookie(request) ? refreshSession(request) : NextResponse.next();
}

/** Matches decks_code_shape in the database, so a path that could never be a code costs no query. */
const DECK_CODE = /^[A-Za-z0-9]{8,32}$/;

/** Row-level security limits the anon client to public decks, which is exactly the question being asked. */
async function publicDeckExists(code: string): Promise<boolean> {
  const { data, error } = await createPublicClient().from("decks").select("id").eq("code", code).limit(1);
  if (error) throw new Error(`Checking deck page ${code} failed: ${error.message}`);
  return data.length > 0;
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

/** Supabase stores the session in cookies named sb-<project>-auth-token (split into .0, .1, ... when large). */
const hasSessionCookie = (request: NextRequest) =>
  request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));

async function refreshSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  try {
    // Reading the claims refreshes an expired access token and writes the new session cookies through setAll.
    await supabase.auth.getClaims();
  } catch (err) {
    console.error("Refreshing the session failed:", err);
  }
  return response;
}

export const config = {
  // Everything except build assets and images; the proxy returns quickly when there's nothing to do.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
