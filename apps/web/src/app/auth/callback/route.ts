import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient, safeNextPath } from "@/lib/server/auth";

/** Where Google sign-in returns: exchanges the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createAuthClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    console.error(`Google sign-in failed: ${error.message}`);
  }
  return NextResponse.redirect(new URL("/sign-in?error=google", request.url));
}
