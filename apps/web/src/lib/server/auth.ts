import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * A Supabase client acting as the visitor, with their session from cookies. Server Actions and Route Handlers can write
 * refreshed session cookies; Server Components can't, so `proxy.ts` refreshes sessions before pages render.
 */
export async function createAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see apps/web/.env.example).");
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which can't set cookies. The proxy keeps the session fresh instead.
        }
      },
    },
  });
}

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in visitor, or null. Reads the request, so callers sit behind <Suspense>. Deliberately uncached: a sign-out
 * must show immediately, and verifying the session is a local token check.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

export { safeNextPath } from "@/lib/safe-path";
