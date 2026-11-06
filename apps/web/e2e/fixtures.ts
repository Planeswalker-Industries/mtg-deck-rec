import { test as base, expect, type Page } from "@playwright/test";

export * from "@playwright/test";

/** How long one fill waits for "Analyze deck" to enable before filling again. */
const FILL_SETTLE_MS = 2_000;

/**
 * Fills the deck tool's Decklist box until "Analyze deck" takes it. A fill that lands before the tool has hydrated, or
 * while it is still restoring its state, is dropped and leaves the button disabled, so fill again until it sticks.
 */
export async function fillDecklist(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Decklist" });
  const analyze = page.getByRole("button", { name: "Analyze deck", exact: true });
  await expect(async () => {
    await box.fill(text);
    await expect(analyze).toBeEnabled({ timeout: FILL_SETTLE_MS });
  }).toPass();
}

/** The deck tool's import offer, made on every visit by a player with no collection. */
const COLLECTION_OFFER = { name: "Hold up — got cards already?" } as const;

/** Answers the deck tool's collection offer with Continue whenever it covers the page, so a check can go on. */
export async function skipCollectionOffer(page: Page) {
  await page.addLocatorHandler(page.getByRole("dialog", COLLECTION_OFFER), async (dialog) => {
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  });
}

/** `test` from Playwright, with the collection offer waved away on the default page. */
export const test = base.extend({
  page: async ({ page }, provide) => {
    await skipCollectionOffer(page);
    await provide(page);
  },
});
