import { expect, test } from "./fixtures";
import { mailpit, signIn } from "./mailpit";

/**
 * Feedback reports (T077): the footer link carries the page it was pressed on, a signed-out visitor is asked to sign
 * in before writing anything, and a report sent by a player reaches the admin list, where it can be resolved.
 */

test("the footer's Send feedback carries the page, and signed out asks to sign in", async ({ page }) => {
  await page.goto("/privacy");
  await page.getByRole("contentinfo").getByRole("link", { name: "Send feedback" }).click();
  await expect(page).toHaveURL(/\/feedback\?from=%2Fprivacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Send feedback" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).last()).toHaveAttribute(
    "href",
    `/sign-in?next=${encodeURIComponent("/feedback?from=%2Fprivacy")}`,
  );
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
});

test("a player's report reaches the admin list and can be resolved", async ({ page, request, browser }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  test.setTimeout(120_000);

  const message = `e2e feedback ${Date.now()}`;
  await signIn(page, request, `e2e-feedback-${Date.now()}@example.com`, "/decks");
  await page.goto("/feedback?from=%2Fdecks");
  await expect(page.getByText("Sent with the page: /decks")).toBeVisible();
  await page.getByLabel("What should we know?").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status").getByText("Sent. Thanks!")).toBeVisible();

  const admin = await browser.newPage();
  await signIn(admin, admin.request, "admin@test.local", "/decks");
  // Admins see how many reports are open: on a phone (the suite's width) the menu button carries the count.
  await expect(admin.getByRole("button", { name: /^Menu, \d+ open feedback reports?(, \d+ open error tickets?)?$/ })).toBeVisible();
  await admin.goto("/admin/reports");
  const row = admin.getByRole("listitem").filter({ hasText: message });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("link", { name: "/decks" })).toBeVisible();

  await row.getByRole("button", { name: "Resolve" }).click();
  await expect(row.getByText("Resolved")).toBeVisible();
  await expect(row.getByRole("button", { name: "Reopen" })).toBeVisible();

  // Resolved, it leaves the open list once the page reloads, and stays in All.
  await admin.reload();
  await expect(admin.getByRole("listitem").filter({ hasText: message })).toHaveCount(0, { timeout: 30_000 });
  await admin.getByRole("button", { name: "All" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: message })).toBeVisible({ timeout: 30_000 });
  await admin.close();
});
