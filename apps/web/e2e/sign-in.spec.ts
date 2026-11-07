import { expect, test } from "@playwright/test";
import { mailpit, signIn } from "./mailpit";

test("sign-in offers Google only, and its button starts the Google flow", async ({ page }) => {
  await page.goto("/sign-in?next=/account");
  const google = page.getByRole("button", { name: "Continue with Google" });
  test.skip((await google.count()) === 0, "this build has Google sign-in off (NEXT_PUBLIC_AUTH_GOOGLE)");
  await expect(page.getByLabel("Email")).toHaveCount(0);

  // Stop at the auth server's authorize step: what lies beyond it is Google's, which a test never drives.
  let authorize: URL | undefined;
  await page.route("**/auth/v1/authorize**", async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google stub</p>" });
  });
  await google.click();
  await expect(page.getByText("Google stub")).toBeVisible({ timeout: 30_000 });

  expect(authorize?.searchParams.get("provider")).toBe("google");
  const callback = new URL(authorize?.searchParams.get("redirect_to") ?? "");
  expect(callback.pathname).toBe("/auth/callback");
  expect(callback.searchParams.get("next")).toBe("/account");
});

test("signs in and signs out", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  const email = `e2e-${Date.now()}@example.com`;

  await signIn(page, request, email, "/account");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Your account" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount|\/sign-in\?next=\/account/, { timeout: 30_000 });
});

test("a bad sign-in link is refused with a readable message", async ({ page }) => {
  await page.goto("/auth/confirm?next=/account&token_hash=0000&type=email");
  await expect(page).toHaveURL(/\/sign-in\?error=link/, { timeout: 30_000 });
  await expect(page.getByText(/That sign-in link didn't work/)).toBeVisible();
});
