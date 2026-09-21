"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ApiError, Result } from "@mtg/core/contract";
import { DELETE_CONFIRMATION } from "@/lib/account";
import { createAuthClient } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

/**
 * Deletes the signed-in visitor's account and everything that belongs to it, then clears their session cookies.
 * `delete_my_account` acts on auth.uid() only, so this can never reach anyone else's account.
 */
export async function deleteAccountAction(input: { confirmation: string }): Promise<Result<null>> {
  const typed = typeof input?.confirmation === "string" ? input.confirmation.trim().toLowerCase() : "";
  if (typed !== DELETE_CONFIRMATION) return failure("VALIDATION", `Type "${DELETE_CONFIRMATION}" to confirm.`);
  try {
    const blocked = await checkRateLimit(createPublicClient(), "auth", visitorKey(await headers()));
    if (blocked) return { ok: false, error: blocked };

    const supabase = await createAuthClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return failure("UNAUTHENTICATED", "Sign in to delete your account.");

    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      console.error(`Deleting an account failed: ${error.message}`);
      // check_violation carries a message written for the visitor (the last platform admin is refused).
      return error.code === "23514"
        ? failure("FORBIDDEN", error.message)
        : failure("UPSTREAM_UNAVAILABLE", "Couldn't delete your account. Nothing was removed; try again in a moment.");
    }

    // The account is gone, so there is no session left to revoke on the server: only the cookies need clearing.
    await supabase.auth.signOut({ scope: "local" });
    // Their decks were public by default; drop the cached list so a deleted deck stops appearing.
    revalidatePath("/decks");
    return { ok: true, data: null };
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't delete your account. Try again in a moment.");
  }
}
