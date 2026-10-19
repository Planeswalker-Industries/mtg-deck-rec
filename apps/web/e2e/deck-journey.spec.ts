import { expect, test, type Locator, type Page } from "@playwright/test";

/** The Cut swipe's accept button, "Cut <card>"; not the "Cut the rest and move on" link under it. */
const CUT_CARD = /^Cut (?!the rest and move on$)/;

/** The step's "8 / 100" counter. The slot tray shows the same on desktop; phones hide it to keep the swipe on screen. */
const DECK_COUNT = /^\d+ \/ 100$/;

/** The deck size the step's counter shows. */
async function deckCount(recs: Locator) {
  return Number((await recs.getByRole("status").getByText(DECK_COUNT).innerText()).split(" / ")[0]);
}

/**
 * A short Chulane deck with one off-colour card (Lightning Bolt), so the Cut phase always has a mandatory cut and Add has
 * room. Every card is in the mock pool and the real catalog alike, so this runs the same against either.
 */
const DECK = [
  "Commander",
  "1 Chulane, Teller of Tales",
  "",
  "Deck",
  "1 Sol Ring",
  "1 Arcane Signet",
  "1 Cultivate",
  "1 Counterspell",
  "1 Swords to Plowshares",
  "1 Lightning Bolt",
  "1 Command Tower",
].join("\n");

async function analyzeDeck(page: Page) {
  await page.goto("/deck");
  await page.getByRole("textbox", { name: "Decklist" }).fill(DECK);
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // With real data the commander may have too few decks, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  return recs;
}

/** From Add, the first step, on to Cut through the stepper. */
async function openCut(page: Page) {
  const recs = page.getByRole("region", { name: "Recommendations" });
  await recs.getByRole("navigation", { name: "Deck upgrade steps" }).getByRole("button", { name: "Cut" }).click();
  return recs;
}

test("walks a deck through add, cut, replace and review, then starts over", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step");
  // Swiping is the default on a first visit: on a phone the view toggle offers the list.
  await expect(recs.getByRole("button", { name: "Show as a list" })).toBeVisible();

  // Add comes first: adding a card asks for the list again.
  const adds = recs.getByRole("region", { name: "Cards to add" });
  const addIt = adds.getByRole("button", { name: /^Add / });
  await expect(addIt).toBeVisible({ timeout: 60_000 });
  const added = ((await addIt.getAttribute("aria-label")) ?? "").replace(/^Add /, "");
  const size = await deckCount(recs);
  await addIt.click();
  await expect(recs.getByRole("status").getByText(DECK_COUNT)).toHaveText(`${size + 1} / 100`);
  // The recomputed list never offers the card just added.
  await expect(adds.getByRole("button", { name: `Add ${added}` })).toBeHidden({ timeout: 60_000 });
  await recs.getByRole("button", { name: /^Done adding/ }).click();

  // Cut: the deck runs an off-colour card, dealt first.
  await expect(steps.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-current", "step");
  const cuts = recs.getByRole("region", { name: "Cards to cut" });
  const cutIt = cuts.getByRole("button", { name: CUT_CARD });
  await expect(cutIt).toBeVisible({ timeout: 60_000 });
  await cutIt.click();
  await recs.getByRole("button", { name: "Next: swaps" }).first().click();

  // Replace: weaker fits, each with a replacement. The deck may have none, which goes on to Review.
  await expect(steps.getByRole("button", { name: "Swap" })).toHaveAttribute("aria-current", "step");
  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const toReview = recs.getByRole("button", { name: "Next: finish" });
  await expect(rater.or(toReview)).toBeVisible({ timeout: 60_000 });
  if (await rater.isVisible()) await rater.getByRole("button", { name: "Finish" }).click();
  else await toReview.click();

  // Review: the numbers before and after, the changes, and the decklist.
  await expect(recs.getByRole("region", { name: "Before and after" })).toBeVisible();
  await expect(recs.getByRole("list", { name: "Cards put in" }).getByText(added.split(" // ")[0] ?? added, { exact: true })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Decklist" })).toBeVisible();

  // Start over, after a confirm, goes back to the deck as the round started, at Add; Undo brings the round back.
  await recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog", { name: "Start this round over?" }).getByRole("button", { name: "Start over" }).click();
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step", { timeout: 60_000 });
  await expect(recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / })).toBeVisible({ timeout: 60_000 });
  await recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Undo" }).click();
  await expect(recs.getByRole("region", { name: "Before and after" })).toBeVisible();
});

test("Undo takes back the last choice, on the step it was made on", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  const undo = recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  const addIt = recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / });
  await expect(addIt).toBeVisible({ timeout: 60_000 });
  const size = await deckCount(recs);
  await addIt.click();
  const count = recs.getByRole("status").getByText(DECK_COUNT);
  await expect(count).toHaveText(`${size + 1} / 100`);

  // Moving on to Cut isn't a choice; Undo steps back over the add and returns to Add.
  await steps.getByRole("button", { name: "Cut" }).click();
  await undo.click();
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step");
  await expect(count).toHaveText(`${size} / 100`);
  await expect(undo).toBeDisabled();
});

// Phones hide the slot tray (the default viewport is a phone).
test("the deck counter lists this round's adds and takes one back out", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const addIt = recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / });
  await expect(addIt).toBeVisible({ timeout: 60_000 });
  const size = await deckCount(recs);
  await addIt.click();
  const count = recs.getByRole("status").getByText(DECK_COUNT);
  await expect(count).toHaveText(`${size + 1} / 100`);

  await count.click();
  const sheet = page.getByRole("dialog", { name: "Added this round" });
  await sheet.getByRole("button", { name: /^Take .+ back out$/ }).click();
  // The last add taken out closes the sheet.
  await expect(sheet).toBeHidden();
  await expect(count).toHaveText(`${size} / 100`);
});

test("the Cut list crosses out recommended cuts and lets any card be cut", async ({ page }) => {
  await analyzeDeck(page);
  const recs = await openCut(page);
  await recs.getByRole("button", { name: "Show as a list" }).click();
  const deck = recs.getByRole("region", { name: "Your deck" });
  await expect(deck).toBeVisible({ timeout: 60_000 });

  // The recommended cut starts marked; a card of the player's own choosing can be marked too.
  const marked = deck.locator('ul button[aria-pressed="true"]');
  await expect(marked).toHaveCount(1, { timeout: 60_000 });
  await deck.locator('ul button[aria-pressed="false"]').first().click();
  await expect(marked).toHaveCount(2);

  // Unmarking the recommended card keeps it.
  await marked.first().click();
  await expect(marked).toHaveCount(1);
});

test("the Replace swipe enlarges a card on tap without swiping the card underneath", async ({ page }) => {
  await analyzeDeck(page);
  const recs = await openCut(page);
  await recs.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: CUT_CARD }).click({ timeout: 60_000 });
  await recs.getByRole("button", { name: "Next: swaps" }).first().click();

  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const swapIn = rater.getByRole("button", { name: /^Swap in / });
  const nothingLeft = recs.getByRole("button", { name: "Next: finish" });
  await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: 20_000 });
  test.skip(await nothingLeft.isVisible(), "no replacements in this data");
  const progress = rater.getByText(/^Card \d+ of \d+/);
  const before = await progress.innerText();
  const candidateBefore = await swapIn.getAttribute("aria-label");

  await rater.getByRole("button", { name: /^Enlarge / }).last().click();
  const enlarged = page.getByRole("dialog", { name: /, enlarged$/ });
  await expect(enlarged).toBeVisible();
  // The layer covers the page, so dismissing it can't reach the buttons or the card below.
  await enlarged.click({ position: { x: 10, y: 10 } });
  await expect(enlarged).toBeHidden();
  // innerText, as `before` was read: the counter hides " to replace" on phones with CSS.
  await expect(progress).toHaveText(before, { useInnerText: true });
  await expect(swapIn).toHaveAttribute("aria-label", candidateBefore ?? "");
});

test("going back from Swap and returning keeps the swaps, and a picked swap reopens its card", async ({ page }) => {
  await analyzeDeck(page);
  const recs = await openCut(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await expect(steps.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-current", "step");
  await recs.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: CUT_CARD }).click({ timeout: 60_000 });
  // The next step in the stepper does what Next does.
  await steps.getByRole("button", { name: "Swap" }).click();
  await expect(steps.getByRole("button", { name: "Swap" })).toHaveAttribute("aria-current", "step");

  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const swapIn = rater.getByRole("button", { name: /^Swap in / });
  const nothingLeft = recs.getByRole("button", { name: "Next: finish" });
  await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: 60_000 });
  test.skip(await nothingLeft.isVisible(), "no replacements in this data");

  const picked = ((await swapIn.getAttribute("aria-label")) ?? "").replace(/^Swap in /, "");
  await swapIn.click();
  const swaps = recs.getByRole("list", { name: "Swaps picked" }).getByRole("button");
  await expect(swaps).toHaveCount(1);

  // Back to Add without changing anything, then straight back to Swap: the swap is still there.
  await steps.getByRole("button", { name: "Add" }).click();
  await expect(steps.getByRole("button", { name: "Swap" })).toBeEnabled();
  await steps.getByRole("button", { name: "Swap" }).click();
  await expect(steps.getByRole("button", { name: "Swap" })).toHaveAttribute("aria-current", "step");
  await expect(swaps).toHaveCount(1);

  // Tapping the swap takes it back and deals its card again, the replacement picked before first.
  await swaps.first().click();
  await expect(swaps).toHaveCount(0);
  await expect(rater.getByRole("button", { name: `Swap in ${picked}` })).toBeVisible({ timeout: 60_000 });
});

test("returning to Swap with the deck unchanged asks for nothing again", async ({ page }) => {
  await analyzeDeck(page);
  const recs = await openCut(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await recs.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: CUT_CARD }).click({ timeout: 60_000 });
  await steps.getByRole("button", { name: "Swap" }).click();
  const swapIn = recs.getByRole("region", { name: "Swipe through cards to replace" }).getByRole("button", { name: /^Swap in / });
  const nothingLeft = recs.getByRole("button", { name: "Next: finish" });
  await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: 60_000 });
  test.skip(await nothingLeft.isVisible(), "no replacements in this data");

  // Records every loading state that shows from here on: the Swap list and a card's replacements each have one.
  const watchLoading = () =>
    page.evaluate(() => {
      const w = window as unknown as { loadingSeen: string[] };
      w.loadingSeen = [];
      new MutationObserver(() => {
        for (const label of ["Looking at the deck again", "Finding replacements"]) {
          if (document.body.innerText.includes(label)) w.loadingSeen.push(label);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  const loadingSeen = () => page.evaluate(() => (window as unknown as { loadingSeen: string[] }).loadingSeen);

  await watchLoading();
  await steps.getByRole("button", { name: "Add" }).click();
  await steps.getByRole("button", { name: "Swap" }).click();
  await expect(swapIn).toBeVisible({ timeout: 60_000 });
  expect(await loadingSeen()).toEqual([]);

  // A changed deck does ask again, which shows the watch sees a load when there is one.
  await watchLoading();
  await steps.getByRole("button", { name: "Add" }).click();
  await recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / }).click({ timeout: 60_000 });
  await steps.getByRole("button", { name: "Cut" }).click();
  await steps.getByRole("button", { name: "Swap" }).click();
  await expect(swapIn).toBeVisible({ timeout: 60_000 });
  expect(await loadingSeen()).toContain("Looking at the deck again");
});
