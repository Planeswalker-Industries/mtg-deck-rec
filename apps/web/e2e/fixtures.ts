import { test as base, type Page } from "@playwright/test";

export * from "@playwright/test";

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
