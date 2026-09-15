"use server";

import { headers } from "next/headers";
import type { ApiError, Result } from "@mtg/core/contract";
import { createAuthClient, safeNextPath } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";
import { SITE_URL } from "@/lib/site";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

/** Where auth links should send the visitor back to. Supabase Auth only accepts addresses on its redirect allow list. */
async function siteOrigin(): Promise<string> {
  const origin = (await headers()).get("origin");
  return origin && /^https?:\/\/[^/]+$/.test(origin) ? origin : SITE_URL;
}

async function limited(): Promise<Result<never> | null> {
  const error = await checkRateLimit(createPublicClient(), "auth", visitorKey(await headers()));
  return error ? { ok: false, error } : null;
}

/** Emails a 6-digit sign-in code and a sign-in link. Creates the account on first sign-in. */
export async function sendSignInEmailAction(input: { email: string; next?: string }): Promise<Result<null>> {
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) return failure("VALIDATION", "Enter a valid email address.");
  try {
    const blocked = await limited();
    if (blocked) return blocked;
    const supabase = await createAuthClient();
    const confirm = new URL("/auth/confirm", await siteOrigin());
    confirm.searchParams.set("next", safeNextPath(input.next));
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: confirm.toString(), shouldCreateUser: true } });
    if (error) {
      console.error(`Sending a sign-in email failed: ${error.message}`);
      return error.status === 429
        ? failure("RATE_LIMITED", "Too many sign-in emails were sent recently. Wait a few minutes and try again.")
        : failure("UPSTREAM_UNAVAILABLE", "Couldn't send the sign-in email. Try again in a moment.");
    }
    return { ok: true, data: null };
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't send the sign-in email. Try again in a moment.");
  }
}

/** Signs in with the 6-digit code from the email. */
export async function verifySignInCodeAction(input: { email: string; code: string }): Promise<Result<null>> {
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const code = typeof input?.code === "string" ? input.code.replace(/\s+/g, "") : "";
  if (!EMAIL.test(email)) return failure("VALIDATION", "Enter a valid email address.");
  if (!CODE.test(code)) return failure("VALIDATION", "Enter the 6-digit code from the email.");
  try {
    const blocked = await limited();
    if (blocked) return blocked;
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) return failure("VALIDATION", "That code didn't work. It may have expired; send yourself a new one.");
    return { ok: true, data: null };
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't check the code. Try again in a moment.");
  }
}

/** Starts Google sign-in and returns the Google address to send the browser to. */
export async function startGoogleSignInAction(input: { next?: string }): Promise<Result<{ url: string }>> {
  if (process.env.NEXT_PUBLIC_AUTH_GOOGLE !== "1") return failure("FORBIDDEN", "Google sign-in isn't available yet. Use your email instead.");
  try {
    const supabase = await createAuthClient();
    const callback = new URL("/auth/callback", await siteOrigin());
    callback.searchParams.set("next", safeNextPath(input?.next));
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      console.error(`Starting Google sign-in failed: ${error?.message ?? "no URL returned"}`);
      return failure("UPSTREAM_UNAVAILABLE", "Couldn't start Google sign-in. Try again in a moment.");
    }
    return { ok: true, data: { url: data.url } };
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't start Google sign-in. Try again in a moment.");
  }
}

export async function signOutAction(): Promise<Result<null>> {
  try {
    const supabase = await createAuthClient();
    await supabase.auth.signOut();
    return { ok: true, data: null };
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't sign out. Try again in a moment.");
  }
}
