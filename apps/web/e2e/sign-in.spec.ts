import { expect, test, type APIRequestContext } from "@playwright/test";

// Needs the local Supabase mail catcher (Mailpit), e.g. E2E_MAILPIT_URL=http://127.0.0.1:56324. CI doesn't run it.
const mailpit = process.env.E2E_MAILPIT_URL;

async function latestCode(request: APIRequestContext, email: string): Promise<string> {
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

test("signs in with an emailed code and signs out", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/sign-in?next=/account");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(`We sent a 6-digit code to ${email}`)).toBeVisible();

  await page.getByLabel("Code").fill(await latestCode(request, email));
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Your account" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount|\/sign-in\?next=\/account/, { timeout: 30_000 });
});

test("a bad code is refused with a readable message", async ({ page }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`e2e-bad-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/That code didn't work/)).toBeVisible();
});
