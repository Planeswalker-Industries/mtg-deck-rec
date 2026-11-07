import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** The local Supabase mail catcher (Mailpit), e.g. E2E_MAILPIT_URL=http://127.0.0.1:56324. CI doesn't run it. */
export const mailpit = process.env.E2E_MAILPIT_URL;

/** How many times to look for the sign-in email, a second apart. */
const MAIL_TRIES = 30;
const MAIL_WAIT_MS = 1000;
/** Mailpit's search returns at most this many messages; plenty for one test address. */
const INBOX_PAGE = 200;

/**
 * The local Supabase project the app runs against. The app reads it from `.env.local`; the test runner doesn't, so it
 * loads that file here (variables already set win). CI has no `.env.local`, and the tests that need this skip there.
 */
function supabaseEnv(): { url: string; key: string } {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local: rely on the environment.
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Signing in needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (apps/web/.env.local).");
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) throw new Error(`Refusing to sign in against ${url}: not a local database.`);
  return { url, key };
}

/** The token hash in the link of the newest sign-in email sent to `email`. */
export async function latestSignInTokenHash(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < MAIL_TRIES; attempt++) {
    const search = await request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`);
    const id = (await search.json()).messages?.[0]?.ID as string | undefined;
    if (id) {
      const message = await (await request.get(`${mailpit}/api/v1/message/${id}`)).json();
      const hash = String(message.HTML ?? message.Text ?? "").match(/token_hash=([0-9a-f]+)/i)?.[1];
      if (hash) return hash;
    }
    await new Promise((resolve) => setTimeout(resolve, MAIL_WAIT_MS));
  }
  throw new Error(`No sign-in email arrived for ${email}`);
}

/**
 * Throws away everything Mailpit is holding for `email`.
 *
 * Tests that sign in as a fixed account (the seeded admin, say) rather than a fresh address share an inbox with
 * every earlier run, and `latestSignInTokenHash` can hand back a link from one of those — which the app correctly
 * refuses. Clearing first makes the next email the only one there is.
 */
export async function clearInbox(request: APIRequestContext, email: string) {
  const search = await request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=${INBOX_PAGE}`);
  const ids = ((await search.json()).messages ?? []).map((message: { ID: string }) => message.ID);
  if (ids.length > 0) await request.delete(`${mailpit}/api/v1/messages`, { data: { IDs: ids } });
}

/**
 * Signs in and waits to land on `next`.
 *
 * Sign-in is Google only for now, and a test can't drive Google's own pages. So it opens /sign-in, checks that the
 * Google button is the way in, then signs in the way a real session starts on the server: a one-time sign-in email
 * from the local auth server, whose link it opens. The app's email form is commented out, not removed, so its server
 * side still works.
 */
export async function signIn(page: Page, request: APIRequestContext, email: string, next: string) {
  await clearInbox(request, email);
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  const { url, key } = supabaseEnv();
  const sent = await request.post(`${url}/auth/v1/otp`, {
    headers: { apikey: key, "content-type": "application/json" },
    data: { email, create_user: true },
  });
  expect(sent.ok(), `sign-in email request answered ${sent.status()}`).toBe(true);

  const hash = await latestSignInTokenHash(request, email);
  await page.goto(`/auth/confirm?next=${encodeURIComponent(next)}&token_hash=${hash}&type=email`);
  await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
}
