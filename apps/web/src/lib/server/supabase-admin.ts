import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type AdminClient = SupabaseClient<Database>;

/**
 * Server-only client with the secret key, which bypasses row-level security. Only for writes the app makes on its own
 * behalf, like switching off a share-link source that answered with bot protection. Never import it into client code or
 * hand it user-controlled queries.
 */
export function createAdminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("The server's Supabase secret key isn't configured: set SUPABASE_SECRET_KEY (see apps/web/.env.example).");
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
