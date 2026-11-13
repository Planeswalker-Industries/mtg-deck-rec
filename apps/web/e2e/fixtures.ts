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

/** The Fix step's pair on screen: one card out, one card in. */
export const FIX_MOVE = { name: "Fix: one card out, one card in" } as const;
/** Fix and Swap wait on a recommendation read, which a cold server takes a while over. */
const STEP_WAIT_MS = 60_000;

const journeySteps = (page: Page) =>
  page.getByRole("region", { name: "Recommendations" }).getByRole("navigation", { name: "Deck upgrade steps" });

/** From Add, on to Fix through the stepper. The decks these checks use are short of 100, so leaving Add asks first. */
export async function openFix(page: Page) {
  await journeySteps(page).getByRole("button", { name: "Fix" }).click();
  await page.getByRole("dialog", { name: "Deck Under 100" }).getByRole("button", { name: "Continue" }).click();
}

/**
 * On to Swap, from Add or from Fix. Fix goes on to Swap by itself when it has no move for the deck; with a pair on
 * offer (or its end panel up) the stepper goes there.
 */
export async function openSwap(page: Page) {
  const recs = page.getByRole("region", { name: "Recommendations" });
  const steps = journeySteps(page);
  const current = steps.locator('button[aria-current="step"]');
  if ((await current.innerText()).trim() === "Add") await openFix(page);
  // Fix has its pool once it shows a pair, shows its end panel, or has gone on to Swap.
  const settled = recs
    .getByRole("region", FIX_MOVE)
    .or(recs.getByRole("button", { name: "Next: swap" }))
    .or(steps.locator('button[aria-current="step"]', { hasText: "Swap" }));
  await expect(settled.first()).toBeVisible({ timeout: STEP_WAIT_MS });
  const swap = steps.getByRole("button", { name: "Swap" });
  if ((await swap.getAttribute("aria-current")) !== "step") await swap.click();
  await expect(swap).toHaveAttribute("aria-current", "step");
}

/**
 * Answers every "Not in your collection" line of a built deck with Ignore, so Continue opens: a collection build
 * waits for an answer to each line the collection couldn't fill.
 */
export async function ignoreBuildGaps(page: Page) {
  const gaps = page.getByRole("region", { name: "Your built deck" }).getByRole("list", { name: "What your collection ran out of" });
  for (const ignore of await gaps.getByRole("button", { name: "Ignore", exact: true }).all()) await ignore.click();
}

/**
 * From Upgrade into the deckbuilder: the round's Save deck is the only way there for a deck that isn't saved yet. It
 * opens with the deck name form up in the deck bar, which the caller may fill or leave. Returns the recommendations
 * region.
 */
export async function toDeckbuilder(page: Page) {
  const recs = page.getByRole("region", { name: "Recommendations" });
  await recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Save deck" }).click({ timeout: STEP_WAIT_MS });
  await expect(page.getByRole("textbox", { name: "Deck name" })).toBeVisible({ timeout: STEP_WAIT_MS });
  return recs;
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
