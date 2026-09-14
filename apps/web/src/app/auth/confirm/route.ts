import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient, safeNextPath } from "@/lib/server/auth";

/**
 * The link in a sign-in email. It carries a one-time token hash rather than a browser-bound code, so it works even when
 * opened on a different device from the one that asked for it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && searchParams.get("type") === "email") {
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    console.error(`Sign-in link failed: ${error.message}`);
  }
  return NextResponse.redirect(new URL("/sign-in?error=link", request.url));
}
