import { expect, test } from "@playwright/test";
import { mailpit, signIn } from "./mailpit";

/** Real local catalog and account actions can take half a minute to finish. */
const SYNC_WAIT_MS = 30_000;

test("a shared collection is read-only to others, sends its owner home and 404s once unshared", async ({ page, request, browser, context }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await signIn(page, request, `e2e-share-collection-${Date.now()}@example.com`, "/collection/import");
  await page.getByLabel("Collection export").fill("3 Sol Ring");
  await page.getByRole("button", { name: /Import collection|Replace collection/ }).click();
  await expect(page.getByRole("region", { name: "Saved collection" }).getByText(/Saved to your account/)).toBeVisible({ timeout: SYNC_WAIT_MS });

  await page.goto("/collection");
  const share = page.getByRole("switch", { name: "Public" });
  await expect(share).toBeEnabled({ timeout: SYNC_WAIT_MS });
  await share.click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/collection\/[A-Za-z0-9]{8,32}$/);
  const path = new URL(link).pathname;

  // The owner's own link goes to their collection, where they can edit it.
  await page.goto(path);
  await expect(page).toHaveURL(/\/collection$/);

  // Signed out, the link shows the cards and nothing that changes them.
  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  await visitor.goto(path);
  await expect(visitor.getByRole("heading", { name: "Shared collection", level: 1 })).toBeVisible({ timeout: SYNC_WAIT_MS });
  await expect(visitor.getByText("1 different cards, 3 copies.")).toBeVisible({ timeout: SYNC_WAIT_MS });
  await expect(visitor.getByRole("button", { name: "Edit collection" })).toHaveCount(0);
  await expect(visitor.getByRole("link", { name: "Import" })).toHaveCount(0);
  await expect(visitor.getByRole("link", { name: "Use in the deck tool" })).toHaveCount(0);
  await expect(visitor.getByRole("switch", { name: "Public" })).toHaveCount(0);

  // Off, the link is a real 404; on again, the same link works.
  await page.goto("/collection");
  await expect(share).toBeChecked({ timeout: SYNC_WAIT_MS });
  await share.click();
  await expect(share).not.toBeChecked();
  // The switch moves at once and is disabled until the change is saved.
  await expect(share).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  expect((await stranger.request.get(path)).status()).toBe(404);

  await share.click();
  await expect(share).toBeEnabled();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  expect((await stranger.request.get(path)).status()).toBe(200);
  await stranger.close();
});

test("a collection link that was never shared is a real 404", async ({ request }) => {
  expect((await request.get("/collection/zzzzzzzzzzzz")).status()).toBe(404);
});
