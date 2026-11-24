import { test as base, expect, type Locator, type Page } from "@playwright/test";

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

/**
 * Facebook's link-preview crawler. Next streams a dynamic page's metadata into the body for browsers and blocks on it
 * only for crawlers it knows, so the head a share preview reads is the one this user agent gets.
 */
export const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** The content of one head meta tag, by its `property` (Open Graph) or `name` (X) attribute. */
export const headMeta = (page: Page, key: string) =>
  page.locator(`head meta[property="${key}"], head meta[name="${key}"]`).first().getAttribute("content");

/** Touch moves between a swipe's start and end, so the drag passes the direction check before it lands. */
const SWIPE_MOVES = 5;

/**
 * A real touch swipe across `target`, from its centre by (dx, dy) px, sent through Chrome's input pipeline (CDP), so
 * the browser turns it into pointer events and scrolls a vertical drag itself, as on a phone. Playwright's touchscreen
 * only taps. Needs `hasTouch: true`.
 */
export async function swipe(target: Locator, dx: number, dy: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("swipe: the target is not on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await target.page().context().newCDPSession(target.page());
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", px: number, py: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y: py }] });
  await touch("touchStart", x, y);
  for (let i = 1; i <= SWIPE_MOVES; i++) await touch("touchMove", x + (dx * i) / SWIPE_MOVES, y + (dy * i) / SWIPE_MOVES);
  await touch("touchEnd", x + dx, y + dy);
  await cdp.detach();
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
 * From Swap on to Finish: the stepper's Finish while a card is dealt (the card has no Finish of its own), "Next: finish"
 * on the empty stop, or nothing when an empty list already moved the round on by itself.
 */
export async function leaveSwap(page: Page) {
  const recs = page.getByRole("region", { name: "Recommendations" });
  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const toReview = recs.getByRole("button", { name: "Next: finish" });
  const finished = recs.getByRole("heading", { name: /^(Deck Complete!|Almost ready)$/ });
  await expect(rater.or(toReview).or(finished).first()).toBeVisible({ timeout: STEP_WAIT_MS });
  if (await rater.isVisible()) await journeySteps(page).getByRole("button", { name: "Finish" }).click();
  else if (await toReview.isVisible()) await toReview.click();
  await expect(finished).toBeVisible({ timeout: STEP_WAIT_MS });
}

/**
 * Answers every "Not in your collection" line of a built deck with Ignore, so Tune it opens: a collection build
 * waits for an answer to each line the collection couldn't fill.
 */
export async function ignoreBuildGaps(page: Page) {
  const gaps = page.getByRole("region", { name: "Your built deck" }).getByRole("list", { name: "What your collection ran out of" });
  for (const ignore of await gaps.getByRole("button", { name: "Ignore", exact: true }).all()) await ignore.click();
}

/**
 * Clears the build start's budget, for tests about something other than the budget: the picker fills in a default (or
 * the last one typed) once it knows about the collection, so this waits for that before clearing both fields.
 */
export async function clearBuildBudget(page: Page) {
  for (const name of ["Max per card", "Max to spend"]) {
    const field = page.getByRole("textbox", { name });
    await expect(field).not.toHaveValue("", { timeout: STEP_WAIT_MS });
    await field.fill("");
  }
}

/**
 * From Upgrade into the deckbuilder: the round's Save is the only way there for a deck that isn't saved yet. It
 * opens with the deck name form up in the deck bar, which the caller may fill or leave. Returns the recommendations
 * region.
 */
export async function toDeckbuilder(page: Page) {
  const recs = page.getByRole("region", { name: "Recommendations" });
  await recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Save", exact: true }).click({ timeout: STEP_WAIT_MS });
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
