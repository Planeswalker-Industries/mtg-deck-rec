import { expect, test, type Page } from "@playwright/test";
import { mailpit, signIn } from "./mailpit";

/** Whether this browser still holds a collection in IndexedDB. */
const hasBrowserCopy = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("mtg-deck-rec", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("collection");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const get = open.result.transaction("collection").objectStore("collection").get("current");
          get.onsuccess = () => resolve(get.result !== undefined);
          get.onerror = () => resolve(false);
        };
      }),
  );

test("a collection imported before signing in moves to the account and drives owned-only suggestions", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  test.setTimeout(180_000);
  const summary = page.getByRole("region", { name: "Saved collection" });
  const copies = summary.locator("dd").nth(1);

  await page.goto("/collection");
  await page.getByLabel("Collection export").fill("3 Sol Ring");
  await page.getByRole("button", { name: "Import collection" }).click();
  await expect(summary.getByText(/Saved in this browser until/)).toBeVisible({ timeout: 30_000 });

  await signIn(page, request, `e2e-collection-${Date.now()}@example.com`, "/collection");
  await expect(summary.getByText(/Saved to your account/)).toBeVisible({ timeout: 30_000 });
  await expect(copies).toHaveText("3");
  expect(await hasBrowserCopy(page)).toBe(false);

  await page.reload();
  await expect(summary.getByText(/Saved to your account/)).toBeVisible({ timeout: 30_000 });

  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  const ownedOnly = page.getByRole("switch", { name: "Only cards I own" });
  await ownedOnly.click();
  await expect(ownedOnly).toBeChecked();
  // The only owned card (Sol Ring) is already in the sample deck, so there's nothing to add.
  await recs.getByRole("button", { name: "List" }).click();
  await recs.getByRole("button", { name: /^Add Missing pieces/ }).click();
  await expect(recs.getByText(/Nothing in your collection fits this deck's colors/)).toBeVisible({ timeout: 60_000 });

  await page.goto("/collection");
  await page.getByLabel("Replace with a new export").fill("2 Arcane Signet\n1 Definitely Not A Real Card");
  await page.getByRole("button", { name: "Replace collection" }).click();
  await expect(summary.getByText("1 line didn't match a card")).toBeVisible({ timeout: 30_000 });
  await expect(copies).toHaveText("2");

  await summary.getByRole("button", { name: "Clear collection" }).click();
  await expect(summary).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("Collection export")).toBeVisible({ timeout: 30_000 });
  await expect(summary).toBeHidden();
});
