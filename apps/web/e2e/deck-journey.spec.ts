import { FIX_MOVE, expect, fillDecklist, openFix, leaveSwap, openSwap, skipCollectionOffer, swipe, test, type Locator, type Page } from "./fixtures";

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
/** Past card-zoom's DISMISS_CLICK_GRACE_MS (400), which ignores a click just after a dismissal. */
const AFTER_DISMISS_GRACE_MS = 500;

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

/** The "Use sample deck" list analyzed: with real data, Liesa at 100 with five suggested cuts and Sol Ring. */
async function analyzeSampleDeck(page: Page) {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  return recs;
}

test("swap in Owned only with nothing to offer says so instead of dealing an empty card", async ({ page }) => {
  // The only owned card (Sol Ring) is in the deck, so no card has a replacement on any rung of the swap ladder (T088).
  await page.goto("/collection/import");
  await page.getByLabel("Collection import").fill("1 Sol Ring");
  await page.getByRole("button", { name: "Import collection" }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: 30_000 });

  // The real catalog gives the Chulane deck no weaker fits to deal at all, so it takes the sample deck, which has five
  // and runs Sol Ring too.
  const recs =
    process.env.E2E_LOCAL_DATA === "1" ? await analyzeSampleDeck(page) : await analyzeDeck(page, deckWith(FORESTS_TO_100));
  const collectionMode = page.getByRole("combobox", { name: "My collection" });
  await collectionMode.click();
  await page.getByRole("option", { name: "Owned only" }).click();
  await expect(collectionMode).toHaveText("Owned only");

  await openSwap(page);
  await expect(recs.getByRole("status").getByText("No valid swaps right now.")).toBeVisible({ timeout: 60_000 });
  // No card was dealt to keep or swap, and the step did not move on to Finish by itself.
  await expect(recs.getByRole("button", { name: /^(Skip|Swap in) / })).toHaveCount(0);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await expect(steps.getByRole("button", { name: "Swap" })).toHaveAttribute("aria-current", "step");
  await expect(recs.getByRole("button", { name: "Next: finish" })).toBeVisible();
});

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
  await expect(recs.getByText(/^Line \d+ of \d+$/)).toBeVisible();
  await move.getByRole("button", { name: /^Swap Lightning Bolt for / }).click();
  // One for one: the deck keeps its size, and the move is off the table.
  await expect(move.getByRole("button", { name: /^Swap Lightning Bolt for / })).toBeHidden({ timeout: 60_000 });

  // Swap: weaker fits, each with a replacement. The deck may have none, which goes on to Finish.
  await openSwap(page);
  await leaveSwap(page);

  // Finish: the deck ready to buy, how the lines stand with the numbers before and after, the changes, and the decklist.
  await expect(recs.getByRole("heading", { name: "Deck Complete!" })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Deck stats" })).toBeVisible();
  await expect(recs.getByRole("list", { name: "Cards put in" }).getByText(added.split(" // ")[0] ?? added, { exact: true })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Out" }).getByText("Lightning Bolt", { exact: true })).toBeVisible();
  await expect(recs.getByRole("region", { name: "Decklist" })).toBeVisible();
  // The round put a card in, so the list offers this round's cards (chosen) or the whole deck.
  const scope = recs.getByRole("region", SHOPPING_LIST).getByRole("group", { name: "Cards to list" });
  await expect(scope.getByRole("button", { name: "This round's cards" })).toHaveAttribute("aria-pressed", "true");

  // Finish carries the round's controls in its top sheet: Start over, after a confirm, goes back to the deck as the
  // round started, at Add; Undo brings the round back, on Finish.
  await recs.getByRole("region", { name: "Deck Complete!" }).getByRole("group", { name: "This round" }).getByRole("button", { name: "Start over" }).click();
  await page.getByRole("dialog", { name: "Start this round over?" }).getByRole("button", { name: "Start over" }).click();
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step", { timeout: 60_000 });
  await expect(recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / })).toBeVisible({ timeout: 60_000 });
  await recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" }).click();
  await expect(steps.getByRole("button", { name: "Finish" })).toHaveAttribute("aria-current", "step", { timeout: 60_000 });
});

test("a deck at 100 opens on Fix, and Auto-Fix previews its moves before one Undo takes them back", async ({ page }) => {
  const recs = await analyzeDeck(page, deckWith(FORESTS_TO_100));
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  // Nothing to add and nothing to cut: the round is Fix, Swap and Finish.
  await expect(steps.getByRole("button")).toHaveText(["Fix", "Swap", "Finish"]);
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  const move = recs.getByRole("region", FIX_MOVE);
  const first = move.getByRole("button", { name: /^Swap Lightning Bolt for / });
  await expect(first).toBeVisible({ timeout: 60_000 });
  // The lines the move changes sit by the cards, with their counts.
  await expect(move.getByRole("list", { name: "What this changes" }).getByRole("listitem").first()).toBeVisible();
  const undo = recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" });
  await expect(undo).toBeDisabled();

  await move.getByRole("button", { name: "Auto-Fix" }).click();
  const sheet = page.getByRole("dialog", { name: "Auto-Fix" });
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

  // Rules and the curve fold into one "N rules to fix" line above the rings, opening the list by name; a stat line
  // carries its reason under its own ring.
  const stats = recs.getByRole("region", { name: "Deck stats" });
  const rules = stats.getByRole("button", { name: /\d+ rules? to fix/ });
  await expect(rules).toHaveAttribute("aria-expanded", "false", { timeout: 60_000 });
  await rules.click();
  const left = stats.getByRole("list", { name: "Lines still off" });
  await expect(left.getByRole("listitem").filter({ hasText: "Not legal here" }).getByRole("button", { name: "Fix", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // The deck is nearly all Forests: Lands is far over, and its Fix opens Fix on that line, ahead of the rule break.
  // Its ring's tip, opened by a tap, carries the Fix.
  await stats.getByRole("button", { name: /^Lands: / }).click();
  await page.getByRole("dialog", { name: /^Lands: / }).getByRole("button", { name: "Fix", exact: true }).click();
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  await expect(recs.getByRole("status").filter({ hasText: /Line \d+ of \d+/ })).toContainText("Lands", { timeout: 60_000 });
});

test("a bracket the deck no longer fits, chosen during Swap or Finish, sends the round back to Fix at the bracket line (T089)", async ({ page }) => {
  // Two Game Changers estimate the deck at Bracket 3, the default, so the round starts without a warning.
  const recs = await analyzeDeck(page, ["Commander", "1 Chulane, Teller of Tales", "", "Deck", ...SPELLS, "1 Rhystic Study", "1 Cyclonic Rift"].join("\n"));
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  const bracket = page.getByRole("combobox", { name: "Bracket" });
  const bracketLine = (n: number) => recs.getByRole("status").filter({ hasText: /Line \d+ of \d+/ }).filter({ hasText: `Bracket ${n}` });

  await openSwap(page);
  await bracket.click();
  await page.getByRole("option", { name: "2 Core" }).click();
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  await expect(bracketLine(2)).toBeVisible({ timeout: 60_000 });

  // From Fix the stepper reaches Finish through Swap.
  await openSwap(page);
  await steps.getByRole("button", { name: "Finish" }).click();
  await expect(steps.getByRole("button", { name: "Finish" })).toHaveAttribute("aria-current", "step");
  await bracket.click();
  await page.getByRole("option", { name: "1 Exhibition" }).click();
  await expect(steps.getByRole("button", { name: "Fix" })).toHaveAttribute("aria-current", "step");
  await expect(bracketLine(1)).toBeVisible({ timeout: 60_000 });
});

test("Undo takes back the last choice, on the step it was made on", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  const undo = recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" });
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

/** Far enough to browse, past the swipe's minimum travel. */
const BROWSE_PX = 120;
/** A drag that is mostly vertical: a scroll, not a swipe. */
const SCROLL_DX_PX = 10;
const SCROLL_DY_PX = -200;
/** How long a browse key press gets to show a new card before the browse counts as at its end. */
const BROWSE_SETTLE_MS = 1_000;
/** More presses than any test list deals, so a browse to the end always stops. */
const MAX_BROWSE_PRESSES = 200;

/** The swipe view of one step: its card (the swipe target), the accept button naming the card, and the line over it. */
function swipeView(recs: Locator, region: string, verb: RegExp) {
  const view = recs.getByRole("region", { name: region });
  const accept = view.getByRole("button", { name: verb });
  return {
    card: view.locator("[data-tour]"),
    accept,
    /** The card on screen, by the accept button's accessible name ("Add Sol Ring"). */
    name: async () => (await accept.getAttribute("aria-label")) ?? "",
    counter: view.getByText(/^Card \d+ of \d+$/),
  };
}

/** Whether a button's accessible name moves off `label` within a browse's settle time: false at the end of a list. */
function movesOff(button: Locator, label: string) {
  return expect(button)
    .not.toHaveAttribute("aria-label", label, { timeout: BROWSE_SETTLE_MS })
    .then(() => true)
    .catch(() => false);
}

/** Swap's pair on screen, after a fresh analysis; skips the test when the data has nothing to replace. */
async function swapView(page: Page) {
  const recs = await analyzeDeck(page);
  await openSwap(page);
  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const swapIn = rater.getByRole("button", { name: /^Swap in / });
  const nothingLeft = recs.getByRole("button", { name: "Next: finish" });
  await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: 60_000 });
  test.skip(await nothingLeft.isVisible(), "no replacements in this data");
  const skip = rater.getByRole("button", { name: /^Skip / });
  const next = rater.getByRole("button", { name: "Next option" });
  return {
    recs,
    rater,
    swapIn,
    skip,
    next,
    previous: rater.getByRole("button", { name: "Previous option" }),
    outgoing: rater.locator('[data-tour="swap.out"]'),
    incoming: rater.locator('[data-tour="swap.in"]'),
    /** The option on screen and the card it replaces, by their buttons' accessible names. */
    candidate: async () => (await swapIn.getAttribute("aria-label")) ?? "",
    target: async () => (await skip.getAttribute("aria-label")) ?? "",
    /** Whether › has another option to show. */
    hasNext: async () => (await next.getAttribute("aria-disabled")) !== "true",
  };
}

/** Fix's pair on screen, after a fresh analysis: Lightning Bolt goes out first, for the rule it breaks. */
async function fixView(page: Page) {
  const recs = await analyzeDeck(page);
  await openFix(page);
  const move = recs.getByRole("region", FIX_MOVE);
  const swapIt = move.getByRole("button", { name: /^Swap .+ for / });
  await expect(swapIt).toBeVisible({ timeout: 60_000 });
  const next = move.getByRole("button", { name: "Next option" });
  return {
    recs,
    move,
    swapIt,
    skip: move.getByRole("button", { name: /^Skip swapping / }),
    next,
    previous: move.getByRole("button", { name: "Previous option" }),
    outgoing: move.locator('[data-tour="fix.out"]'),
    incoming: move.locator('[data-tour="fix.in"]'),
    undo: recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" }),
    /** The pair on screen, by the Swap button's accessible name ("Swap Lightning Bolt for Ponder"). */
    pair: async () => (await swapIt.getAttribute("aria-label")) ?? "",
    /** Whether › has another card to put in to show. */
    hasNext: async () => (await next.getAttribute("aria-disabled")) !== "true",
  };
}

test.describe("browsing by touch", () => {
  test.use({ hasTouch: true });

  test("add: a swipe browses without adding", async ({ page }) => {
    const recs = await analyzeDeck(page);
    const add = swipeView(recs, "Cards to add", /^Add /);
    await expect(add.accept).toBeVisible({ timeout: 60_000 });
    const size = await deckCount(recs);
    // Add has no "n of m" over the card.
    await expect(add.counter).toBeHidden();
    const first = await add.name();

    await swipe(add.card, -BROWSE_PX, 0);
    await expect(add.accept).not.toHaveAttribute("aria-label", first);
    const second = await add.name();
    expect(await deckCount(recs)).toBe(size);

    await swipe(add.card, BROWSE_PX, 0);
    await expect(add.accept).toHaveAttribute("aria-label", first);
    expect(await deckCount(recs)).toBe(size);

    // A swiped-past card is still there to decide: browse back to it and add it.
    await swipe(add.card, -BROWSE_PX, 0);
    await expect(add.accept).toHaveAttribute("aria-label", second);
    await add.accept.click();
    await expect(recs.getByRole("status").getByText(DECK_COUNT)).toHaveText(`${size + 1} / 100`);
  });

  test("add: a vertical drag scrolls", async ({ page }) => {
    const recs = await analyzeDeck(page);
    const add = swipeView(recs, "Cards to add", /^Add /);
    await expect(add.accept).toBeVisible({ timeout: 60_000 });
    const first = await add.name();
    // The step scrolls itself into view, which can leave the page at its foot: start from the top so it can scroll.
    await page.evaluate(() => window.scrollTo(0, 0));
    await swipe(add.card, SCROLL_DX_PX, SCROLL_DY_PX);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(add.accept).toHaveAttribute("aria-label", first);
  });

  test("add: the first and last cards spring back", async ({ page }) => {
    const recs = await analyzeDeck(page);
    const add = swipeView(recs, "Cards to add", /^Add /);
    await expect(add.accept).toBeVisible({ timeout: 60_000 });
    const first = await add.name();
    await swipe(add.card, BROWSE_PX, 0);
    await expect(add.accept).toHaveAttribute("aria-label", first);

    // Browse to the end: a press that no longer changes the card is the last one.
    let last = first;
    for (let i = 0; i < MAX_BROWSE_PRESSES; i++) {
      await page.keyboard.press("ArrowRight");
      const moved = await expect(add.accept)
        .not.toHaveAttribute("aria-label", last, { timeout: BROWSE_SETTLE_MS })
        .then(() => true)
        .catch(() => false);
      if (!moved) break;
      last = await add.name();
    }
    expect(last).not.toBe(first);
    await swipe(add.card, -BROWSE_PX, 0);
    await expect(add.accept).toHaveAttribute("aria-label", last);
  });

  test("cut: a swipe browses without cutting", async ({ page }) => {
    const recs = await analyzeDeck(page, deckWith(FORESTS_OVER_100));
    const cut = swipeView(recs, "Cards to cut", CUT_CARD);
    await expect(cut.accept).toBeVisible({ timeout: 60_000 });
    const count = recs.getByRole("status").getByText(DECK_COUNT);
    await expect(count).toHaveText("105 / 100");
    // The rule break comes first.
    await expect(cut.accept).toHaveAttribute("aria-label", "Cut Lightning Bolt");
    await expect(cut.counter).toHaveText(/^Card 1 of \d+$/);
    await swipe(cut.card, -BROWSE_PX, 0);
    await expect(cut.accept).not.toHaveAttribute("aria-label", "Cut Lightning Bolt");
    await expect(cut.counter).toHaveText(/^Card 2 of \d+$/);
    await expect(count).toHaveText("105 / 100");
    await swipe(cut.card, BROWSE_PX, 0);
    await expect(cut.accept).toHaveAttribute("aria-label", "Cut Lightning Bolt");
  });

  test("swap: a swipe on the card going in browses options", async ({ page }) => {
    const swap = await swapView(page);
    test.skip(!(await swap.hasNext()), "one replacement only in this data");
    await expect(swap.previous).toHaveAttribute("aria-disabled", "true");
    const first = await swap.candidate();
    await swipe(swap.incoming, -BROWSE_PX, 0);
    await expect(swap.swapIn).not.toHaveAttribute("aria-label", first);
    await expect(swap.previous).toHaveAttribute("aria-disabled", "false");
    await swipe(swap.incoming, BROWSE_PX, 0);
    await expect(swap.swapIn).toHaveAttribute("aria-label", first);
    await expect(swap.previous).toHaveAttribute("aria-disabled", "true");
  });

  test("swap: a swipe on the card going out browses the deck", async ({ page }) => {
    const swap = await swapView(page);
    const first = await swap.target();
    // On a later option, so the browse is seen to deal the next card's first.
    if (await swap.hasNext()) {
      await swap.next.click();
      await expect(swap.previous).toHaveAttribute("aria-disabled", "false");
    }
    await swipe(swap.outgoing, -BROWSE_PX, 0);
    test.skip(!(await movesOff(swap.skip, first)), "one card to replace only in this data");
    await expect(swap.previous).toHaveAttribute("aria-disabled", "true", { timeout: 60_000 });
    await swipe(swap.outgoing, BROWSE_PX, 0);
    await expect(swap.skip).toHaveAttribute("aria-label", first);
  });

  test("swap: browsing records nothing", async ({ page }) => {
    const swap = await swapView(page);
    // A pass, keep or swap is a choice Undo can take back; a browse is none.
    const undo = swap.recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" });
    await expect(undo).toBeDisabled();
    await swipe(swap.incoming, -BROWSE_PX, 0);
    await swipe(swap.outgoing, -BROWSE_PX, 0);
    await expect(swap.swapIn).toBeVisible({ timeout: 60_000 });
    await swipe(swap.incoming, -BROWSE_PX, 0);
    await expect(undo).toBeDisabled();
  });

  test("fix: a swipe on the card going in browses the cards to put in", async ({ page }) => {
    const fix = await fixView(page);
    await expect(fix.undo).toBeDisabled();
    const first = await fix.pair();
    expect(first).toMatch(/^Swap Lightning Bolt for /);
    await swipe(fix.incoming, -BROWSE_PX, 0);
    test.skip(!(await movesOff(fix.swapIt, first)), "one card to put in only in this data");
    // The card going out stays, and a browse is no choice for Undo to take back.
    await expect(fix.swapIt).toHaveAttribute("aria-label", /^Swap Lightning Bolt for /);
    await expect(fix.previous).toHaveAttribute("aria-disabled", "false");
    await expect(fix.undo).toBeDisabled();
    await swipe(fix.incoming, BROWSE_PX, 0);
    await expect(fix.swapIt).toHaveAttribute("aria-label", first);
    await expect(fix.previous).toHaveAttribute("aria-disabled", "true");
  });

  test("fix: a swipe on the card going out browses the cards to take out", async ({ page }) => {
    const fix = await fixView(page);
    // Bolt is the only card that breaks the rule; the line after it has cards to choose from.
    await fix.swapIt.click();
    await expect(fix.move.getByRole("button", { name: /^Swap Lightning Bolt for / })).toBeHidden({ timeout: 60_000 });
    const end = fix.recs.getByRole("button", { name: "Next: swap" });
    await expect(fix.swapIt.or(end)).toBeVisible({ timeout: 60_000 });
    test.skip(await end.isVisible(), "no second line in this data");
    const first = await fix.pair();
    // On a later card to put in, so the browse is seen to start the next card out at its first.
    // (Fix finds its cards as they are asked for, so › can be on with nothing past it.)
    if (await fix.hasNext()) {
      await fix.next.click();
      await movesOff(fix.swapIt, first);
    }
    const before = await fix.pair();
    await swipe(fix.outgoing, -BROWSE_PX, 0);
    test.skip(!(await movesOff(fix.swapIt, before)), "one card to take out only in this data");
    await expect(fix.previous).toHaveAttribute("aria-disabled", "true");
    await swipe(fix.outgoing, BROWSE_PX, 0);
    await expect(fix.swapIt).toHaveAttribute("aria-label", first);
  });
});

test("fix: arrow keys browse the cards to put in, and Skip passes the pair on screen", async ({ page }) => {
  const fix = await fixView(page);
  // OUT and IN over the cards, and no count: how many options there are doesn't help the choice (owner, 2026-11-24).
  await expect(fix.move.getByText("Out", { exact: true })).toBeVisible();
  await expect(fix.move.getByText("In", { exact: true })).toBeVisible();
  await expect(fix.move.getByText(/\d+ of (\d+|many)$/)).toHaveCount(0);
  const first = await fix.pair();
  await page.keyboard.press("ArrowRight");
  test.skip(!(await movesOff(fix.swapIt, first)), "one card to put in only in this data");
  const second = await fix.pair();
  await page.keyboard.press("ArrowLeft");
  await expect(fix.swapIt).toHaveAttribute("aria-label", first);
  await fix.next.click();
  await expect(fix.swapIt).toHaveAttribute("aria-label", second);
  // Skip passes on the second pair, not the first: the pairs start over, and the first comes back.
  await fix.skip.click();
  await expect(fix.swapIt).toHaveAttribute("aria-label", first);
  await expect(fix.previous).toHaveAttribute("aria-disabled", "true");
});

test("add: ArrowRight browses", async ({ page }) => {
  const recs = await analyzeDeck(page);
  const add = swipeView(recs, "Cards to add", /^Add /);
  await expect(add.accept).toBeVisible({ timeout: 60_000 });
  const size = await deckCount(recs);
  const first = await add.name();
  await page.keyboard.press("ArrowRight");
  await expect(add.accept).not.toHaveAttribute("aria-label", first);
  expect(await deckCount(recs)).toBe(size);
  await page.keyboard.press("ArrowLeft");
  await expect(add.accept).toHaveAttribute("aria-label", first);
});

test("swap: › and ArrowRight show the next option", async ({ page }) => {
  const swap = await swapView(page);
  await expect(swap.rater.getByRole("button", { name: /^Pass on / })).toHaveCount(0);
  await expect(swap.next).toBeVisible();
  // OUT and IN over the cards, and no count (owner, 2026-11-24).
  await expect(swap.rater.getByText("Out", { exact: true })).toBeVisible();
  await expect(swap.rater.getByText("In", { exact: true })).toBeVisible();
  await expect(swap.rater.getByText(/\d+ of \d+$/)).toHaveCount(0);
  test.skip(!(await swap.hasNext()), "one replacement only in this data");
  const first = await swap.candidate();
  await swap.next.click();
  await expect(swap.swapIn).not.toHaveAttribute("aria-label", first);
  const second = await swap.candidate();
  await page.keyboard.press("ArrowLeft");
  await expect(swap.swapIn).toHaveAttribute("aria-label", first);
  await page.keyboard.press("ArrowRight");
  await expect(swap.swapIn).toHaveAttribute("aria-label", second);
});

test("swap: a swap passes on the options seen before it, in one Undo step", async ({ page }) => {
  const swap = await swapView(page);
  test.skip(!(await swap.hasNext()), "one replacement only in this data");
  const first = await swap.candidate();
  const undo = swap.recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" });
  const swaps = swap.recs.getByRole("list", { name: "Swaps picked" }).getByRole("button");
  const swapSecond = async () => {
    const before = await swap.candidate();
    await swap.next.click();
    await expect(swap.swapIn).not.toHaveAttribute("aria-label", before);
    const picked = await swap.candidate();
    await swap.swapIn.click();
    await expect(swaps).toHaveCount(1);
    return picked;
  };

  // The swap and the pass on option 1 are one choice: one Undo takes both back, and option 1 is offered again.
  await swapSecond();
  await undo.click();
  await expect(swaps).toHaveCount(0);
  await expect(undo).toBeDisabled();
  await expect(swap.swapIn).toHaveAttribute("aria-label", first, { timeout: 60_000 });
  await expect(swap.previous).toHaveAttribute("aria-disabled", "true");

  // Reopened, the card deals the picked option first, without the one passed over.
  const picked = await swapSecond();
  await swaps.first().click();
  await expect(swaps).toHaveCount(0);
  await expect(swap.swapIn).toHaveAttribute("aria-label", picked, { timeout: 60_000 });
  const seen = [picked];
  while ((await swap.hasNext()) && seen.length < MAX_BROWSE_PRESSES) {
    await swap.next.click();
    await expect(swap.swapIn).not.toHaveAttribute("aria-label", seen.at(-1)!);
    seen.push(await swap.candidate());
  }
  expect(seen).not.toContain(first);
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

  // The browser's Back button closes the enlarged card and stays on the page.
  const url = page.url();
  await page.waitForTimeout(AFTER_DISMISS_GRACE_MS);
  await rater.getByRole("button", { name: /^Enlarge / }).last().click();
  await expect(enlarged).toBeVisible();
  await page.goBack();
  await expect(enlarged).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(progress).toHaveText(before, { useInnerText: true });

  // Closing it by a tap drops its history entry, so the next Back closes the next card, not the page.
  await rater.getByRole("button", { name: /^Enlarge / }).last().click();
  await enlarged.click({ position: { x: 10, y: 10 } });
  await expect(enlarged).toBeHidden();
  await page.waitForTimeout(AFTER_DISMISS_GRACE_MS);
  await rater.getByRole("button", { name: /^Enlarge / }).last().click();
  await expect(enlarged).toBeVisible();
  await page.goBack();
  await expect(enlarged).toBeHidden();
  expect(page.url()).toBe(url);
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
  await expect(upgrades.getByText(/^\$/).first()).toBeVisible();

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

/** Finish's shopping list; its heading reads "Shopping list 8" (the total leads Finish, above it). */
const SHOPPING_LIST = { name: /^Shopping list \d+$/ };

/** Straight to Finish from a deck at 100: no changes, so the list offers the whole deck. */
async function finishAt100(page: Page) {
  const recs = await analyzeDeck(page, deckWith(FORESTS_TO_100));
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await expect(recs.getByRole("region", FIX_MOVE)).toBeVisible({ timeout: 60_000 });
  await steps.getByRole("button", { name: "Swap" }).click();
  await steps.getByRole("button", { name: "Finish" }).click();
  const list = recs.getByRole("region", SHOPPING_LIST);
  await expect(list).toBeVisible({ timeout: 60_000 });
  // Without a collection a pasted deck counts as the player's own: the list opens on this round's cards, none here,
  // and Whole deck lists the deck for one they don't own yet.
  const scope = list.getByRole("group", { name: "Cards to list" });
  await expect(scope.getByRole("button", { name: "This round's cards" })).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByText("This round put in no cards to buy.")).toBeVisible();
  await scope.getByRole("button", { name: "Whole deck" }).click();
  return list;
}

/** Remove a line: one click with a mouse, or a tap that arms the button and a second that confirms on a touch screen. */
async function removeLine(list: Locator, name: string | RegExp) {
  await list.getByRole("button", { name, exact: typeof name === "string" }).first().click();
  const armed = list.getByRole("button", { name: /, tap again to confirm$/ });
  if (await armed.isVisible()) await armed.click();
}

test("Finish shows a shopping list by type, removes and undoes", async ({ page }) => {
  const list = await finishAt100(page);

  // Grouped by type; basics never listed.
  await expect(list.getByRole("list", { name: "Instants to buy" }).getByText("Counterspell", { exact: true })).toBeVisible();
  await expect(list.getByRole("list", { name: "Lands to buy" }).getByText("Command Tower", { exact: true })).toBeVisible();
  await expect(list.getByText("Forest", { exact: true })).toBeHidden();

  // Remove a line, then Undo brings it back.
  await removeLine(list, "Remove Sol Ring");
  await expect(list.getByText("Sol Ring", { exact: true })).toBeHidden();
  // The Undo toast sits over the page (portalled to <body>), not inside the list.
  const undo = page.getByRole("status").filter({ hasText: "Removed Sol Ring." });
  await undo.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByText("Sol Ring", { exact: true })).toBeVisible();

  // No copy button of its own: Finish already offers Copy decklist at the top.
  await expect(list.getByRole("button", { name: /^Copy/ })).toHaveCount(0);

  // Buy leads Finish, above the list (which has none of its own), and goes to TCGplayer's Mass Entry as a paid outbound link.
  await expect(list.getByRole("link", { name: /^Buy on TCGplayer/ })).toHaveCount(0);
  const buy = page.getByRole("region", { name: "Deck Complete!" }).getByRole("link", { name: "Buy on TCGplayer" });
  await expect(buy).toHaveAttribute("rel", /sponsored/);
  await expect(buy).toHaveAttribute("href", /massentry/);
});

/** The first dollar amount in a text, as a number ("$1,234.56" → 1234.56). */
function firstUsd(text: string): number {
  const match = /\$([\d,]+\.\d{2})/.exec(text);
  if (!match?.[1]) throw new Error(`no dollar amount in "${text}"`);
  return Number(match[1].replace(/,/g, ""));
}

/** Finish's total line: "80 cards to buy, $254.59 (Nov 16, 2026)". */
const finishTotal = (page: Page) => page.getByRole("region", { name: "Deck Complete!" }).getByText(/^\d+ cards? to buy, \$/);

/** The cart total as Finish's top line, the docked Deck stats bar and the sheet's Budget line show it. */
async function cartTotals(page: Page): Promise<{ heading: number; bar: number; budget: number }> {
  const heading = firstUsd(await finishTotal(page).innerText());
  const dock = page.getByRole("button", { name: /^Deck stats/ });
  const bar = firstUsd(await dock.innerText());
  await dock.click();
  const sheet = page.getByRole("dialog", { name: "Deck stats" });
  const budget = firstUsd(await sheet.getByRole("region", { name: "Budget" }).getByRole("button", { name: /^Budget:/ }).innerText());
  await sheet.getByRole("button", { name: "Close deck stats" }).click();
  await expect(sheet).toBeHidden();
  return { heading, bar, budget };
}

test("Finish's totals follow the shopping list", async ({ page }) => {
  const list = await finishAt100(page);
  const before = await cartTotals(page);
  expect(before.bar).toBe(before.heading);
  expect(before.budget).toBe(before.heading);

  // Remove a priced line: all three drop by its price.
  const line = list.getByRole("listitem").filter({ hasText: /\$\d/ }).first();
  const price = firstUsd(await line.innerText());
  const name = await line.getByRole("button", { name: /^Remove / }).getAttribute("aria-label");
  await removeLine(list, name ?? /^Remove /);
  const cents = (usd: number) => Math.round(usd * 100);
  await expect.poll(async () => cents(firstUsd(await finishTotal(page).innerText()))).toBe(cents(before.heading - price));
  const after = await cartTotals(page);
  expect(cents(after.bar)).toBe(cents(after.heading));
  expect(cents(after.budget)).toBe(cents(after.heading));
});

test("remove all then undo", async ({ page }) => {
  const list = await finishAt100(page);
  const removeButtons = list.getByRole("button", { name: /^Remove / });
  while ((await removeButtons.count()) > 0) await removeLine(list, /^Remove /);

  await expect(list.getByRole("heading", { level: 3 }).first()).toHaveText("Shopping list 0");
  // Nothing to buy shows no Buy at all, never a greyed one (T102).
  const ready = page.getByRole("region", { name: "Deck Complete!" });
  await expect(ready.getByText("Buy on TCGplayer")).toHaveCount(0);
  await expect(ready.getByText("You removed every card.")).toBeVisible();

  await expect(list.getByText("You removed every card.")).toBeVisible();
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("heading", { level: 3 }).first()).toHaveText("Shopping list 1");
});
