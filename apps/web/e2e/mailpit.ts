import type { APIRequestContext, Page } from "@playwright/test";

/** The local Supabase mail catcher (Mailpit), e.g. E2E_MAILPIT_URL=http://127.0.0.1:56324. CI doesn't run it. */
export const mailpit = process.env.E2E_MAILPIT_URL;

/** The 6-digit code from the newest sign-in email sent to `email`. */
export async function latestSignInCode(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`);
    const id = (await search.json()).messages?.[0]?.ID as string | undefined;
    if (id) {
      const message = await (await request.get(`${mailpit}/api/v1/message/${id}`)).json();
      const code = String(message.Text ?? message.HTML ?? "").match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No sign-in email arrived for ${email}`);
}

/**
 * Throws away everything Mailpit is holding for `email`.
 *
 * Tests that sign in as a fixed account (the seeded admin, say) rather than a fresh address share an inbox with
 * every earlier run, and `latestSignInCode` can hand back a code from one of those — which the app correctly
 * refuses. Clearing first makes the next email the only one there is.
 */
export async function clearInbox(request: APIRequestContext, email: string) {
  const search = await request.get(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=200`);
  const ids = ((await search.json()).messages ?? []).map((message: { ID: string }) => message.ID);
  if (ids.length > 0) await request.delete(`${mailpit}/api/v1/messages`, { data: { IDs: ids } });
}

/** Signs in on /sign-in with an emailed code, then waits to land on `next`. */
export async function signIn(page: Page, request: APIRequestContext, email: string, next: string) {
  await clearInbox(request, email);
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Code").fill(await latestSignInCode(request, email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
}
