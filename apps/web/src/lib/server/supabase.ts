import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type PublicClient = SupabaseClient<Database>;

/**
 * Server-side client with the publishable key: reads public catalog data through RLS.
 * No session: the deck tool works without an account.
 */
export function createPublicClient(): PublicClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see apps/web/.env.example).",
    );
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
