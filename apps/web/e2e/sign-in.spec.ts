import { expect, test } from "@playwright/test";
import { latestSignInCode as latestCode, mailpit } from "./mailpit";

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
