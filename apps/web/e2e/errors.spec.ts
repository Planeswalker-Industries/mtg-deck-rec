import { expect, test } from "./fixtures";
import { mailpit, signIn } from "./mailpit";

/**
 * Error tickets: an error nothing caught in a visitor's browser reaches /admin/errors with where it happened and which
 * account it was, and can be resolved there. Needs the real Server Actions (the mocks keep reports in the console) and
 * the server's secret key, which writes the ticket.
 */

test("a browser error opens a ticket an admin can read and resolve", async ({ page, request, browser }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  test.skip(process.env.NEXT_PUBLIC_USE_MOCKS === "1", "the mock APIs don't send reports");
  test.setTimeout(120_000);

  const message = `e2e window error ${Date.now()}`;
  await signIn(page, request, `e2e-errors-${Date.now()}@example.com`, "/collection");
  // An inline script on the page, thrown from a timer, so nothing catches it but the window: the listener in the root
  // layout sends it. (Inline, so its filename is the page's own URL and the listener's origin check lets it through.)
  await page.addScriptTag({ content: `setTimeout(() => { throw new Error(${JSON.stringify(message)}); });` });

  const admin = await browser.newPage();
  await signIn(admin, admin.request, "admin@test.local", "/decks");
  const row = admin.getByRole("listitem").filter({ hasText: message }).first();
  // The report is written after its action answers, so the list may need a moment (and a reload) to show it.
  await expect(async () => {
    await admin.goto("/admin/errors");
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(row.getByText("window.error")).toBeVisible();
  await expect(row.getByText("Browser")).toBeVisible();
  await expect(row.getByRole("link", { name: "/collection" })).toBeVisible();

  await row.getByRole("button", { name: "Details" }).click();
  // The event names the account by id (a UUID), never by its email.
  await expect(row.getByText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)).toBeVisible();
  await expect(row.getByText(/e2e-errors-.*@example\.com/)).toHaveCount(0);

  await row.getByRole("button", { name: "Resolve" }).click();
  await expect(row.getByText("Resolved")).toBeVisible();
  await admin.close();
});
