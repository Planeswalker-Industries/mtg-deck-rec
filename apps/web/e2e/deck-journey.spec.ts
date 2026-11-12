import { FIX_MOVE, expect, fillDecklist, openFix, openSwap, skipCollectionOffer, test, type Locator, type Page } from "./fixtures";

/** The Cut swipe's accept button, "Cut <card>"; not the "Cut the rest and move on" link under it. */
const CUT_CARD = /^Cut (?!the rest and move on$)/;

/** The step's "8 / 100" counter. The slot tray shows the same on desktop; phones hide it to keep the swipe on screen. */
const DECK_COUNT = /^\d+ \/ 100$/;

/** The deck size the step's counter shows. */
async function deckCount(recs: Locator) {
  return Number((await recs.getByRole("status").getByText(DECK_COUNT).innerText()).split(" / ")[0]);
}

/** The cards every test deck runs beside its commander: one is off-colour (Lightning Bolt), so it breaks a rule. */
const SPELLS = ["1 Sol Ring", "1 Arcane Signet", "1 Cultivate", "1 Counterspell", "1 Swords to Plowshares", "1 Lightning Bolt", "1 Command Tower"];
/** Forests that bring the deck (a commander and the seven cards above) to exactly 100, and to five over it. */
const FORESTS_TO_100 = 92;
const FORESTS_OVER_100 = 97;

const deckWith = (forests: number) =>
  ["Commander", "1 Chulane, Teller of Tales", "", "Deck", ...SPELLS, ...(forests > 0 ? [`${forests} Forest`] : [])].join("\n");

/**
 * A short Chulane deck with one off-colour card (Lightning Bolt), so Add has room and Fix has a rule break to trade out.
 * Every card is in the mock pool and the real catalog alike, so this runs the same against either.
 */
const DECK = deckWith(0);

async function analyzeDeck(page: Page, deck = DECK) {
  await page.goto("/deck");
  await fillDecklist(page, deck);
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // With real data the commander may have too few decks, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  return recs;
}

test("walks a short deck through add, fix, swap and finish, then starts over", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step");
  // A deck under 100 has nothing to cut: the round runs Add, Fix, Swap and Finish.
  await expect(steps.getByRole("button")).toHaveText(["Add", "Fix", "Swap", "Finish"]);
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

  // Fix: the off-colour card is its first line, traded for a card that is legal here.
  await openFix(page);
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  const move = recs.getByRole("region", FIX_MOVE);
  await expect(move).toBeVisible({ timeout: 60_000 });
  await expect(recs.getByText("Not legal here")).toBeVisible();
  await expect(recs.getByText(/^line \d+ of \d+$/)).toBeVisible();
  await move.getByRole("button", { name: /^Swap Lightning Bolt for / }).click();
  // One for one: the deck keeps its size, and the move is off the table.
  await expect(move.getByRole("button", { name: /^Swap Lightning Bolt for / })).toBeHidden({ timeout: 60_000 });

  // Swap: weaker fits, each with a replacement. The deck may have none, which goes on to Finish.
  await openSwap(page);
  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const toReview = recs.getByRole("button", { name: "Next: finish" });
  await expect(rater.or(toReview)).toBeVisible({ timeout: 60_000 });
  if (await rater.isVisible()) await rater.getByRole("button", { name: "Finish" }).click();
  else await toReview.click();

  // Finish: how the lines stand, the numbers before and after, the changes, and the decklist.
  await expect(recs.getByRole("region", { name: "Deck stats" })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Before and after" })).toBeVisible();
  await expect(recs.getByRole("list", { name: "Cards put in" }).getByText(added.split(" // ")[0] ?? added, { exact: true })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Out" }).getByText("Lightning Bolt", { exact: true })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Decklist" })).toBeVisible();

  // Start over, after a confirm, goes back to the deck as the round started, at Add; Undo brings the round back.
  await recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog", { name: "Start this round over?" }).getByRole("button", { name: "Start over" }).click();
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step", { timeout: 60_000 });
  await expect(recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / })).toBeVisible({ timeout: 60_000 });
  await recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Undo" }).click();
  await expect(recs.getByRole("region", { name: "Before and after" })).toBeVisible();
});

test("a deck at 100 opens on Fix, and Fix the rest previews its moves before one Undo takes them back", async ({ page }) => {
  const recs = await analyzeDeck(page, deckWith(FORESTS_TO_100));
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  // Nothing to add and nothing to cut: the round is Fix, Swap and Finish.
  await expect(steps.getByRole("button")).toHaveText(["Fix", "Swap", "Finish"]);
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  const move = recs.getByRole("region", FIX_MOVE);
  const first = move.getByRole("button", { name: /^Swap Lightning Bolt for / });
  await expect(first).toBeVisible({ timeout: 60_000 });
  // The lines the move changes sit by the cards, with their counts.
  await expect(move.getByRole("list", { name: "What this changes in Deck stats" }).getByRole("listitem").first()).toBeVisible();
  const undo = recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  await move.getByRole("button", { name: "Fix the rest for me" }).click();
  const sheet = page.getByRole("dialog", { name: "Fix the rest" });
  const apply = sheet.getByRole("button", { name: /^Apply \d+$/ });
  await expect(apply).toBeVisible();
  const planned = Number((await apply.innerText()).replace("Apply ", ""));
  expect(planned).toBeGreaterThan(1);
  // Every move starts selected; tapping one leaves it out, and the score is graded again.
  await expect(sheet.getByText(/^\d+\/\d+$/).first()).toBeVisible();
  await sheet.locator('button[aria-pressed="true"]').first().click();
  await expect(apply).toHaveText(`Apply ${planned - 1}`);
  await sheet.locator('button[aria-pressed="false"]').first().click();
  await expect(apply).toHaveText(`Apply ${planned}`);
  await apply.click();
  await expect(sheet).toBeHidden();
  await expect(first).toBeHidden({ timeout: 60_000 });

  // The batch is one choice: one Undo brings the first move back.
  await undo.click();
  await expect(first).toBeVisible({ timeout: 60_000 });
  await expect(undo).toBeDisabled();

  // Skipping a pair offers another for the same card rather than the same pair again.
  const pair = await first.getAttribute("aria-label");
  await move.getByRole("button", { name: /^Skip swapping / }).click();
  await expect(move.getByRole("button", { name: pair ?? "", exact: true })).toBeHidden({ timeout: 60_000 });
});

test("Finish names each line still off with its reason, and its Fix opens Fix at that line", async ({ page }) => {
  const recs = await analyzeDeck(page, deckWith(FORESTS_TO_100));
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  // Straight through without fixing anything: Fix has moves, so every line it could fix is still off at Finish.
  await expect(recs.getByRole("region", FIX_MOVE)).toBeVisible({ timeout: 60_000 });
  await steps.getByRole("button", { name: "Swap" }).click();
  await steps.getByRole("button", { name: "Finish" }).click();

  const left = recs.getByRole("region", { name: "Deck stats" }).getByRole("list", { name: "Lines still off" });
  await expect(left.getByRole("listitem").filter({ hasText: "Not legal here" })).toContainText("Can be fixed", { timeout: 60_000 });
  // The deck is nearly all Forests: Lands is far over, and its Fix opens Fix on that line, ahead of the rule break.
  const lands = left.getByRole("listitem").filter({ hasText: /^Lands: \d+, about \d+ is typical/ });
  await expect(lands).toContainText("Can be fixed");
  await lands.getByRole("button", { name: "Fix", exact: true }).click();
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  await expect(recs.getByRole("status").filter({ hasText: /line \d+ of \d+/ })).toContainText("Lands", { timeout: 60_000 });
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

  // Moving on to Fix isn't a choice; Undo steps back over the add and returns to Add.
  await openFix(page);
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

test("a deck over 100 opens on Cut, which deals the rule break first and stops at 100", async ({ page }) => {
  const recs = await analyzeDeck(page, deckWith(FORESTS_OVER_100));
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  // Nothing to add: the round is Cut, Fix, Swap and Finish, and Fix stays shut while the deck is over 100.
  await expect(steps.getByRole("button")).toHaveText(["Cut", "Fix", "Swap", "Finish"]);
  await expect(steps.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-current", "step");
  await expect(steps.getByRole("button", { name: "Fix" })).toBeDisabled();
  await expect(recs.getByRole("status").getByText(DECK_COUNT)).toHaveText("105 / 100", { timeout: 60_000 });
  const cuts = recs.getByRole("region", { name: "Cards to cut" });
  await expect(cuts.getByRole("button", { name: CUT_CARD })).toBeVisible({ timeout: 60_000 });
  await cuts.getByRole("button", { name: "Cut Lightning Bolt", exact: true }).click();
  await expect(recs.getByRole("status").getByText(DECK_COUNT)).toHaveText("104 / 100");
});

test("the Cut list crosses out recommended cuts and lets any card be cut", async ({ page }) => {
  const recs = await analyzeDeck(page, deckWith(FORESTS_OVER_100));
  await recs.getByRole("button", { name: "Show as a list" }).click();
  const deck = recs.getByRole("region", { name: "Your deck" });
  await expect(deck).toBeVisible({ timeout: 60_000 });

  // The recommended cut starts marked; a card of the player's own choosing can be marked too.
  const bolt = deck.getByRole("button", { name: /^Lightning Bolt/ });
  await expect(bolt).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  // A single-copy card (the Forests count down a copy a tap instead). Its caption changes as it is marked, so it is
  // found by the card's name, the first line of the button.
  const other = deck.locator('ul button[aria-pressed="false"]').filter({ hasNotText: /Forest|Lightning Bolt/ }).first();
  const name = (await other.innerText()).split("\n")[0]?.trim() ?? "";
  const chosen = deck.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
  await chosen.click();
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  await chosen.click();
  await expect(chosen).toHaveAttribute("aria-pressed", "false");

  // Unmarking the recommended card keeps it.
  await bolt.click();
  await expect(bolt).toHaveAttribute("aria-pressed", "false");
  // The deck is still over 100, so the way on stays shut.
  await expect(recs.getByRole("button", { name: /^Cut \d+ more first$/ })).toBeDisabled();
});

test("the Replace swipe enlarges a card on tap without swiping the card underneath", async ({ page }) => {
  const recs = await analyzeDeck(page);
  await openSwap(page);

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
  const recs = await analyzeDeck(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await openSwap(page);
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
  await page.getByRole("dialog", { name: "Deck Under 100" }).getByRole("button", { name: "Continue" }).click();
  await expect(steps.getByRole("button", { name: "Swap" })).toHaveAttribute("aria-current", "step");
  await expect(swaps).toHaveCount(1);

  // Tapping the swap takes it back and deals its card again, the replacement picked before first.
  await swaps.first().click();
  await expect(swaps).toHaveCount(0);
  await expect(rater.getByRole("button", { name: `Swap in ${picked}` })).toBeVisible({ timeout: 60_000 });
});

test("returning to Swap with the deck unchanged asks for nothing again", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await openSwap(page);
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
  await page.getByRole("dialog", { name: "Deck Under 100" }).getByRole("button", { name: "Continue" }).click();
  await expect(swapIn).toBeVisible({ timeout: 60_000 });
  expect(await loadingSeen()).toEqual([]);

  // A changed deck does ask again, which shows the watch sees a load when there is one.
  await watchLoading();
  await steps.getByRole("button", { name: "Add" }).click();
  await recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / }).click({ timeout: 60_000 });
  await openSwap(page);
  await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: 60_000 });
  expect(await loadingSeen()).toContain("Looking at the deck again");
});

test("Add's combos: ready and upgrade sections, and Add Combo", async ({ page }) => {
  test.skip(process.env.E2E_LOCAL_DATA === "1", "The stand-in combos exist only in the mocks");
  const recs = await analyzeDeck(page);
  await expect(recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / })).toBeVisible({ timeout: 60_000 });

  // The deck holds Sol Ring and Counterspell, each one card short of a stand-in combo.
  await recs.getByRole("button", { name: "Combos (2)" }).click();
  await expect(recs.getByRole("heading", { name: "Combos" })).toBeVisible();
  await expect(recs.getByRole("link", { name: "Commander Spellbook" })).toHaveAttribute("href", "https://commanderspellbook.com/");
  // No collection: the ready section is the way to upload one.
  await expect(recs.getByRole("link", { name: "Upload a collection" })).toHaveAttribute("href", /collection%2Fimport|collection\/import/);
  const upgrades = recs.locator("details", { hasText: "Combo Upgrades" });
  if (!(await upgrades.getAttribute("open").then((v) => v !== null))) await upgrades.locator("summary").click();
  await expect(upgrades.getByText("Win the game")).toBeVisible();
  await expect(upgrades.getByRole("link", { name: "via Counterspell" })).toHaveAttribute("href", /commanderspellbook\.com\/combo\/mock-combo-2\//);
  await expect(upgrades.getByText(/^About \$/).first()).toBeVisible();

  const before = await deckCount(recs);
  await upgrades.getByRole("button", { name: /^Add Swan Song/ }).click();
  await expect.poll(() => deckCount(recs)).toBe(before + 1);
  await expect(upgrades.getByRole("button", { name: /^Add Swan Song/ })).toHaveCount(0);
});

/** From a fresh analysis to Swap's list; the names Swap deals. */
async function swapTargets(page: Page, addSwanSong: boolean): Promise<string[]> {
  const recs = await analyzeDeck(page);
  await expect(recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / })).toBeVisible({ timeout: 60_000 });
  if (addSwanSong) {
    await recs.getByRole("button", { name: /^Combos \(\d+\)$/ }).click();
    const upgrades = recs.locator("details", { hasText: "Combo Upgrades" });
    if ((await upgrades.getAttribute("open")) === null) await upgrades.locator("summary").click();
    await upgrades.getByRole("button", { name: /^Add Swan Song/ }).click();
  }
  await openSwap(page);
  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  await expect(rater.or(recs.getByRole("button", { name: "Next: finish" })).first()).toBeVisible({ timeout: 20_000 });
  await recs.getByRole("button", { name: "Show as a list" }).click();
  const list = recs.getByRole("list", { name: "Cards worth replacing" });
  await expect(list).toBeVisible({ timeout: 20_000 });
  return list.getByRole("listitem").allInnerTexts();
}

test("Swap never deals a piece of a combo the deck holds", async ({ page, browser }) => {
  test.skip(process.env.E2E_LOCAL_DATA === "1", "The stand-in combos exist only in the mocks");
  const without = await swapTargets(page, false);
  test.skip(!without.some((t) => t.includes("Counterspell")), "Swap doesn't deal Counterspell in this data, so there's nothing to hold back");
  // A fresh visitor, so the deck tool doesn't offer the last deck back.
  const fresh = await browser.newContext({ viewport: page.viewportSize() });
  const freshPage = await fresh.newPage();
  await skipCollectionOffer(freshPage);
  const withCombo = await swapTargets(freshPage, true);
  await fresh.close();
  expect(withCombo.some((t) => t.includes("Counterspell"))).toBe(false);
});
