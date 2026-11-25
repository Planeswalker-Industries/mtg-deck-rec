import { TOURS_ENABLED_KEY, TOURS_SEEN_KEY } from "../src/lib/constants";
import {
  CUT_CARD,
  FIX_MOVE,
  FORESTS_OVER_100,
  clearBuildBudget,
  deckWith,
  expect,
  fillDecklist,
  leaveSwap,
  openFix,
  openSwap,
  swipe,
  test,
  toDeckbuilder,
  type Page,
} from "./fixtures";
import { mailpit, signIn } from "./mailpit";

// Every other spec runs with tours off (playwright.config.ts); these start from an empty browser, where they are on.
test.use({ storageState: { cookies: [], origins: [] } });

/** Most tests here walk a deck into the journey and then a tour, each wait up to PAGE_WAIT_MS on a cold server. */
const TOUR_TEST_TIMEOUT_MS = 120_000;
test.describe.configure({ timeout: TOUR_TEST_TIMEOUT_MS });

const tutorials = (page: Page) => page.getByRole("switch", { name: "Tutorials" });
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

async function signInToAccount(page: Page, request: Parameters<typeof signIn>[1]) {
  await signIn(page, request, `e2e-tours-${Date.now()}@example.com`, "/account");
  await expect(tutorials(page)).toBeVisible({ timeout: 30_000 });
}

test("the Tutorials switch defaults on and turns off", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await signInToAccount(page, request);
  await expect(tutorials(page)).toBeChecked();

  await page.getByRole("button", { name: /^Tutorials\s*: What this does$/ }).click();
  await expect(page.getByRole("dialog", { name: "Tutorials" })).toContainText("once on this device");
  await page.keyboard.press("Escape");

  await tutorials(page).click();
  await expect(tutorials(page)).not.toBeChecked();
  expect(await stored(page, TOURS_ENABLED_KEY)).toBe("0");

  await page.reload();
  await expect(tutorials(page)).not.toBeChecked();
});

test("turning tutorials on clears the seen list", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await signInToAccount(page, request);
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify(["commander"])), TOURS_SEEN_KEY);
  await page.reload();

  await tutorials(page).click();
  await expect(tutorials(page)).not.toBeChecked();
  expect(JSON.parse((await stored(page, TOURS_SEEN_KEY)) ?? "null")).toEqual(["commander"]);

  await tutorials(page).click();
  await expect(tutorials(page)).toBeChecked();
  expect(await stored(page, TOURS_ENABLED_KEY)).toBe("1");
  expect(JSON.parse((await stored(page, TOURS_SEEN_KEY)) ?? "null")).toEqual([]);
});

test("blocked storage still renders the switch", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await signInToAccount(page, request);

  // As in private browsing with site data blocked: every touch of localStorage throws.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.reload();

  await expect(tutorials(page)).toBeChecked();
  await tutorials(page).click();
  await expect(tutorials(page)).not.toBeChecked();
  await tutorials(page).click();
  await expect(tutorials(page)).toBeChecked();
  expect(errors).toEqual([]);
});

// The build start's tour (`lib/tours.ts`), on the mock catalog: no collection, so step 3 lights the import link.
const BUILD_START = "/deck?start=build";
/** Longer than the provider's wait for a step's element, so a tour that would show has shown. */
const TOUR_SETTLE_MS = 2_500;
/** The lit hole's reach past its element (`TOUR_CUTOUT_PAD_PX`). */
const CUTOUT_PAD_PX = 8;
/** Rounding slack for comparing layout boxes, in CSS pixels. */
const LAYOUT_SLACK_PX = 2;
/** The page loading cold on the production build. */
const PAGE_WAIT_MS = 30_000;
/** A build on a cold server. */
const BUILD_WAIT_MS = 90_000;

const tour = (page: Page) => page.getByRole("dialog", { name: "Tour" });
const seen = async (page: Page): Promise<string[]> => JSON.parse((await stored(page, TOURS_SEEN_KEY)) ?? "[]");
const commanderBox = (page: Page) => page.getByRole("combobox", { name: "Commander", exact: true });

async function openBuildStartTour(page: Page) {
  await page.goto(BUILD_START);
  await expect(tour(page)).toContainText("So you want to BUILD a COMMANDER DECK, huh?", { timeout: PAGE_WAIT_MS });
}

/**
 * › until the bubble says `text`. textContent, not innerText: a new bubble is hidden for its first frame while it is
 * measured, and innerText would read it as empty and press › once too often.
 */
async function nextUntil(page: Page, text: string) {
  await expect(async () => {
    if (!((await tour(page).textContent()) ?? "").includes(text)) await tour(page).getByRole("button", { name: "Next step" }).click();
    await expect(tour(page)).toContainText(text, { timeout: 1_000 });
  }).toPass();
}

/** The lit ring sits on the element, the pad out from each edge. */
async function expectRingOn(page: Page, target: string) {
  await expect
    .poll(async () => {
      const ring = await page.locator("[data-tour-ring]").boundingBox();
      const element = await page.locator(`[data-tour="${target}"]:visible`).boundingBox();
      if (!ring || !element) return Infinity;
      return Math.max(
        Math.abs(ring.x - (element.x - CUTOUT_PAD_PX)),
        Math.abs(ring.y - (element.y - CUTOUT_PAD_PX)),
        Math.abs(ring.width - (element.width + 2 * CUTOUT_PAD_PX)),
        Math.abs(ring.height - (element.height + 2 * CUTOUT_PAD_PX)),
      );
    })
    .toBeLessThanOrEqual(LAYOUT_SLACK_PX);
}

/**
 * A swipe on a lit element, once the ring sits on it: until then the page may still be scrolling it into view, or the
 * bubble still be where the last step put it.
 */
async function swipeLit(page: Page, target: string, dx: number, dy: number) {
  await expectRingOn(page, target);
  await swipe(page.locator(`[data-tour="${target}"]:visible`), dx, dy);
}

/** The bubble is inside the viewport and beside the element, not over it. */
async function expectBubbleBeside(page: Page, target: string) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const bubble = await tour(page).boundingBox();
      const element = await page.locator(`[data-tour="${target}"]:visible`).boundingBox();
      if (!bubble || !element) return "unmeasured";
      const inside =
        bubble.x >= 0 && bubble.y >= 0 && bubble.x + bubble.width <= viewport.width && bubble.y + bubble.height <= viewport.height;
      const apart = bubble.y >= element.y + element.height || bubble.y + bubble.height <= element.y;
      return inside && apart ? "beside" : JSON.stringify({ bubble, element });
    })
    .toBe("beside");
}

test("build start tour shows once", async ({ page }) => {
  await openBuildStartTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("build-start");

  await page.reload();
  await expect(commanderBox(page)).toBeVisible({ timeout: PAGE_WAIT_MS });
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(tour(page)).toHaveCount(0);
});

test("the scrim ignores taps", async ({ page }) => {
  await openBuildStartTour(page);
  await nextUntil(page, "IMPORT your COLLECTION first");
  // Max to spend is dimmed on this step, well below the bubble: a tap on it neither focuses it nor takes typing. (The
  // Commander box is dimmed too, but on a phone the bubble sits over it.)
  const spend = page.getByRole("textbox", { name: "Max to spend" });
  const value = await spend.inputValue();
  const box = (await spend.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type("7");
  await expect(spend).toHaveValue(value);
  await expect(spend).not.toBeFocused();
  await expect(tour(page)).toContainText("IMPORT your COLLECTION first");
  await expect(page).toHaveURL(/[?&]start=build/);
});

test("Esc ends the tour", async ({ page }) => {
  await openBuildStartTour(page);
  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("build-start");
});

test("build start tour walks the form; tapping Build deck builds and ends it", async ({ page }) => {
  await openBuildStartTour(page);
  await nextUntil(page, "come to the right place");
  await nextUntil(page, "IMPORT your COLLECTION first");
  await nextUntil(page, "type part of your COMMANDER's name");
  await expectBubbleBeside(page, "build-start.commander");

  // The lit box takes typing; once a commander is picked, the step lights the plate in its place.
  await commanderBox(page).fill("Chulane");
  await page
    .getByRole("option", { name: /Chulane/ })
    .first()
    .click({ timeout: PAGE_WAIT_MS });
  await expect(tour(page)).toContainText("Here's your COMMANDER");

  await nextUntil(page, "pick 3!");
  await nextUntil(page, "Don't want a $10,000 DECK?");
  await clearBuildBudget(page);
  await nextUntil(page, "off to the races");

  await page.getByRole("button", { name: "Build deck" }).click();
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("build-start");
  await expect(page.getByRole("region", { name: "Your built deck" })).toBeVisible({ timeout: BUILD_WAIT_MS });

  // The built deck's own tour: the list, Buy, Save for Later, then Tune it, whose tap ends it.
  await expect(tour(page)).toContainText("Here's your new DECK", { timeout: PAGE_WAIT_MS });
  await expectRingOn(page, "build-result.list");
  await nextUntil(page, "fine tune this DECK");
  await expectRingOn(page, "build-result.tune");
  await page.locator('[data-tour="build-result.tune"]').click();
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("build-result");
});

test("the overlay follows its element on scroll and resize", async ({ page }) => {
  await openBuildStartTour(page);
  await nextUntil(page, "pick 3!");
  await expectRingOn(page, "build-start.bracket");
  await expectBubbleBeside(page, "build-start.bracket");

  await page.evaluate(() => window.scrollBy(0, 200));
  await expectRingOn(page, "build-start.bracket");

  await page.setViewportSize({ width: 1280, height: 900 });
  await expectRingOn(page, "build-start.bracket");
  await expectBubbleBeside(page, "build-start.bracket");
});

test("tours off: no overlay", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "0"), TOURS_ENABLED_KEY);
  await page.goto(BUILD_START);
  await expect(commanderBox(page)).toBeVisible({ timeout: PAGE_WAIT_MS });
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(tour(page)).toHaveCount(0);
});

// The paste screen's tour (`deck-start`): the path tiles and Bracket move on when tapped, the rest on ›.
const DECK_START = "/deck";
const DECK_START_TARGETS = [
  "deck-start.heading",
  "deck-start.owned",
  "deck-start.online",
  "deck-start.paste",
  "deck-start.bracket",
  "deck-start.budget",
  "deck-start.file",
  "deck-start.go",
] as const;

async function openDeckStartTour(page: Page) {
  await page.goto(DECK_START);
  await expect(tour(page)).toContainText("Got a DECK already?", { timeout: PAGE_WAIT_MS });
}

test("deck start tour runs once", async ({ page }) => {
  await openDeckStartTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("deck-start");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Decklist" })).toBeVisible({ timeout: PAGE_WAIT_MS });
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(tour(page)).toHaveCount(0);
});

test("deck start tour elements are on the page", async ({ page }) => {
  await openDeckStartTour(page);
  for (const target of DECK_START_TARGETS) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
});

test("deck start tour: tapping the tiles, Bracket and Analyze deck moves on", async ({ page }) => {
  await openDeckStartTour(page);
  await nextUntil(page, "UPLOAD your COLLECTION and improve");
  await expectBubbleBeside(page, "deck-start.owned");
  await page.getByRole("radio", { name: /Cards I own/ }).click();
  await expect(tour(page)).toContainText("absolute best cards out there");
  await page.getByRole("radio", { name: /Best cards online/ }).click();
  await expect(tour(page)).toContainText("PASTE your decklist here");
  // The lit box takes typing.
  await page.getByRole("textbox", { name: "Decklist" }).fill("Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring");

  await nextUntil(page, "pick 3!");
  await page.getByRole("combobox", { name: "Bracket" }).click();
  await page.getByRole("option", { name: /^2/ }).click();
  await expect(tour(page)).toContainText("Set a MAX PER CARD");
  await expect(page.getByRole("combobox", { name: "Bracket" })).toHaveText(/^2/);

  await nextUntil(page, "Once your list is in");
  await expectRingOn(page, "deck-start.go");
  await page.getByRole("button", { name: "Analyze deck" }).click();
  // The journey's own tour may follow at once.
  await expect(tour(page).filter({ hasText: "Once your list is in" })).toHaveCount(0);
  await expect.poll(() => seen(page)).toContain("deck-start");
});

// The journey page's tours on the mock sample (under 100, so the round opens on Add): `journey` (the deck bar and the
// steps), then `add` (role pills, the card, its chips, Skip and Add).
const JOURNEY_TARGETS = ["journey.bar", "journey.step.add"] as const;
const ADD_TARGETS = ["add.roles", "add.all", "add.card", "add.chips", "add.decide"] as const;
const JOURNEY_FIRST = "Welcome to the DECK Journey!";

async function openJourneyTour(page: Page) {
  await openDeckStartTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await expect(tour(page)).toContainText(JOURNEY_FIRST, { timeout: PAGE_WAIT_MS });
}

/** The swipe card in Add, by the name its Add button gives it. */
const addButton = (page: Page) => page.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / });

test("journey tour runs once", async ({ page }) => {
  await openJourneyTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  expect(await seen(page)).toContain("journey");
  // Add's tour follows on the step the round opens on: skipped too, so the page is free again.
  await expect(tour(page)).toContainText("Add", { timeout: PAGE_WAIT_MS });
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toBeHidden();

  await page.getByRole("button", { name: "Edit decklist" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await expect(page.getByRole("button", { name: "Edit decklist" })).toBeVisible({ timeout: PAGE_WAIT_MS });
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(page.getByText(JOURNEY_FIRST)).toHaveCount(0);
});

test("journey and add tour elements are on the page", async ({ page }) => {
  await openJourneyTour(page);
  for (const target of [...JOURNEY_TARGETS, ...ADD_TARGETS]) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
});

// The swipe step needs a touch screen (`swipe`).
test.describe("journey tours by touch", () => {
  test.use({ hasTouch: true });

  test("journey tour names the first step, then Add's tour walks the swipe view", async ({ page }) => {
    await openJourneyTour(page);
    // The journey ends on the step the round opens on: tapping it hands over to Add's tour.
    await nextUntil(page, "TAP ADD to start!");
    await expectRingOn(page, "journey.step.add");
    await expect(tour(page)).toContainText("Deck Journey");
    await page.locator('[data-tour="journey.step.add"]').click();

    // Add's tour, its own chapter: a role pill narrows the list, ALL puts it back.
    await expect(tour(page)).toContainText("DECK SHORTAGE PIPS", { timeout: PAGE_WAIT_MS });
    await expect(page.locator('[data-tour="add.chips"]')).toBeVisible();
    await nextUntil(page, "TAP one to see only those cards");
    await page.locator('[data-tour="add.roles"] button[aria-pressed="false"]').first().click();
    await expect(tour(page)).toContainText("TAP ALL");
    await page.locator('[data-tour="add.all"]').click();
    await expect(tour(page)).toContainText("SWIPE to see more");

    // The swipe browses: another card, the deck's count unchanged, and the tour stays for more swipes until ›.
    const before = await addButton(page).getAttribute("aria-label");
    const status = page.getByRole("region", { name: "Recommendations" }).getByText(/^\d+ \/ 100$/).first();
    const count = await status.innerText();
    await swipeLit(page, "add.card", -200, 0);
    await expect(addButton(page)).not.toHaveAttribute("aria-label", before!);
    await expect(status).toHaveText(count);
    await expect(tour(page)).toContainText("SWIPE to see more");
    await nextUntil(page, "STAT CHANGE PIPS");

    await nextUntil(page, "Green is GOOD!");
    await nextUntil(page, "TAP ADD to put it");
    await expectRingOn(page, "add.decide");
    await addButton(page).click();
    await expect(tour(page)).toBeHidden();
    expect(await seen(page)).toEqual(expect.arrayContaining(["journey", "add"]));
  });
});

// Cut's tour (`cut`) on a deck over 100: the round opens on Cut, and tapping CUT in the journey's tour hands over.
const CUT_TARGETS = ["cut.count", "cut.card", "cut.why", "cut.chips", "cut.decide"] as const;
const CUT_FIRST = "Looks like you've got TOO MANY cards!";
const cutButton = (page: Page) => page.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: CUT_CARD });

async function openCutTour(page: Page) {
  await openDeckStartTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await fillDecklist(page, deckWith(FORESTS_OVER_100));
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await expect(tour(page)).toContainText(JOURNEY_FIRST, { timeout: PAGE_WAIT_MS });
  await nextUntil(page, "TAP CUT to start!");
  await expectRingOn(page, "journey.step.cut");
  await page.locator('[data-tour="journey.step.cut"]').click();
  await expect(tour(page)).toContainText(CUT_FIRST, { timeout: PAGE_WAIT_MS });
}

test("cut tour elements are on the page", async ({ page }) => {
  await openCutTour(page);
  await expect(tour(page)).toContainText("Cut");
  for (const target of CUT_TARGETS) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
});

test.describe("cut tour by touch", () => {
  test.use({ hasTouch: true });

  test("cut tour: the swipe browses, then Cut ends it", async ({ page }) => {
    await openCutTour(page);
    await expectRingOn(page, "cut.count");
    await nextUntil(page, "SWIPE to see other CUT candidates!");

    // The swipe browses: another card, the deck's count unchanged, and the tour stays for more swipes until ›.
    const before = await cutButton(page).getAttribute("aria-label");
    const count = page.locator('[data-tour="cut.count"]');
    const shown = await count.innerText();
    await swipeLit(page, "cut.card", -200, 0);
    await expect(cutButton(page)).not.toHaveAttribute("aria-label", before!);
    await expect(count).toHaveText(shown);
    await expect(tour(page)).toContainText("SWIPE to see other CUT candidates!");
    await nextUntil(page, "says WHY");
    await expectRingOn(page, "cut.why");

    // The pips step is skipped when the card browsed to has none.
    await nextUntil(page, "TAP these buttons");
    await expectRingOn(page, "cut.decide");
    await cutButton(page).click();
    await expect(tour(page)).toBeHidden();
    expect(await seen(page)).toContain("cut");
  });
});

// The Save Deck page's tour (`save-deck`): the round's Save opens the Deckbuilder with the name form up.
const SAVE_DECK_FIRST = "This is your COMMANDER PANEL.";
const SAVE_DECK_TARGETS = ["save-deck.bar", "save-deck.list", "save-deck.card", "save-deck.name", "save-deck.save"] as const;

async function openSaveDeckTour(page: Page) {
  await openJourneyTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  // Add's tour follows the journey's; it goes too.
  await expect(tour(page)).toContainText("DECK SHORTAGE PIPS", { timeout: PAGE_WAIT_MS });
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await toDeckbuilder(page);
  await expect(tour(page)).toContainText(SAVE_DECK_FIRST, { timeout: PAGE_WAIT_MS });
}

test("save deck tour elements are on the page", async ({ page }) => {
  await openSaveDeckTour(page);
  await expect(tour(page)).toContainText("Save Deck");
  for (const target of SAVE_DECK_TARGETS) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
});

test("save deck tour: the card plate opens the full card, then name and Save", async ({ page }) => {
  await openSaveDeckTour(page);
  await nextUntil(page, "TAP a CARD PLATE");
  await expectRingOn(page, "save-deck.card");
  await page.locator('[data-tour="save-deck.card"]').click();
  // The tour waits behind the enlarged card, and goes on once it closes.
  const zoom = page.locator("[data-card-zoom]");
  await expect(zoom).toBeVisible();
  await zoom.click();
  await expect(zoom).toBeHidden();
  await expect(tour(page)).toContainText("Great job on this DECK.");
  await expectRingOn(page, "save-deck.name");
  await nextUntil(page, "TAP SAVE");
  await expectRingOn(page, "save-deck.save");
  await tour(page).getByRole("button", { name: "Skip" }).click();
  expect(await seen(page)).toContain("save-deck");
});

test("save deck tour runs once", async ({ page }) => {
  await openSaveDeckTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await toDeckbuilder(page);
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(page.getByText(SAVE_DECK_FIRST)).toHaveCount(0);
});

// Deck stats' tour (`deck-stats`): on desktop on Swap's swipe view; on a phone the first time the player taps the bar.
// The bar and the rail stamp the same ids, one copy laid out at a time, so the tests read the visible one.
const DECK_STATS_FIRST = "This here is the DECK STATS Panel!";
const deckStatsBar = (page: Page) => page.locator('[data-tour="deck-stats.bar"]');
const deckStatsSheet = (page: Page) => page.getByRole("dialog", { name: "Deck stats" });

/** The journey on the sample deck with its opening tours skipped. */
async function journeyWithoutTours(page: Page) {
  await openJourneyTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toContainText("DECK SHORTAGE PIPS", { timeout: PAGE_WAIT_MS });
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toBeHidden();
}

const SWAP_FIRST = "Welcome to SWAP!";

/** On to Swap past Fix's tour (Skip), to Swap's tour. */
async function openSwapTour(page: Page) {
  await openFix(page);
  await expect(tour(page)).toContainText(FIX_FIRST, { timeout: PAGE_WAIT_MS });
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await openSwap(page);
  await expect(tour(page)).toContainText(SWAP_FIRST, { timeout: PAGE_WAIT_MS });
}

/** On to Swap past Fix's and Swap's tours; on desktop Deck stats' tour follows them there. */
async function swapPastItsTour(page: Page) {
  await openSwapTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
}

test("opening Deck stats first runs its tour instead, once", async ({ page }) => {
  await journeyWithoutTours(page);
  await deckStatsBar(page).click();
  await expect(tour(page)).toContainText(DECK_STATS_FIRST);
  await expect(tour(page)).toContainText("Deck Stats");
  await expect(deckStatsSheet(page)).toBeHidden();
  await expectRingOn(page, "deck-stats.bar");
  await nextUntil(page, "This is your SCORE");
  await expectRingOn(page, "deck-stats.score");
  await nextUntil(page, "SWIPE UP to explore the details");
  // A tap opens the sheet as a swipe does, and ends the tour.
  await deckStatsBar(page).click();
  await expect(deckStatsSheet(page)).toBeVisible();
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("deck-stats");

  // Seen: the bar opens the sheet as usual.
  await page.keyboard.press("Escape");
  await expect(deckStatsSheet(page)).toBeHidden();
  await deckStatsBar(page).click();
  await expect(deckStatsSheet(page)).toBeVisible();
  await expect(tour(page)).toBeHidden();
});

test.describe("deck stats tour by touch", () => {
  test.use({ hasTouch: true });

  test("on a phone deck stats tour waits for a tap on the bar, and ends on a swipe up", async ({ page }) => {
    await journeyWithoutTours(page);
    await swapPastItsTour(page);
    // On a phone it doesn't follow Swap's tour (owner, 2026-11-25).
    await page.waitForTimeout(TOUR_SETTLE_MS);
    await expect(tour(page)).toBeHidden();
    await deckStatsBar(page).click();
    await expect(tour(page)).toContainText(DECK_STATS_FIRST, { timeout: PAGE_WAIT_MS });
    await expect(deckStatsSheet(page)).toBeHidden();
    await expectBubbleBeside(page, "deck-stats.bar");
    await nextUntil(page, "SWIPE UP to explore the details");
    await expectRingOn(page, "deck-stats.bar");
    await swipe(deckStatsBar(page), 0, -120);
    await expect(deckStatsSheet(page)).toBeVisible();
    await expect(tour(page)).toBeHidden();
    expect(await seen(page)).toContain("deck-stats");
  });
});

test.describe("deck stats tour on desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("deck stats tour lights the rail and ends on its rings", async ({ page }) => {
    await journeyWithoutTours(page);
    await swapPastItsTour(page);
    await expect(tour(page)).toContainText(DECK_STATS_FIRST, { timeout: PAGE_WAIT_MS });
    await expectRingOn(page, "deck-stats.rail");
    await nextUntil(page, "This is your SCORE");
    await expectRingOn(page, "deck-stats.score");
    await nextUntil(page, "Explore the details down here");
    await expectRingOn(page, "deck-stats.rings");
    await tour(page).getByRole("button", { name: "Done" }).click();
    expect(await seen(page)).toContain("deck-stats");
  });
});

// Fix's tour (`fix`) on its pair: the pair, the card going out, the card going in, the whole trade, Auto-Fix.
const FIX_FIRST = "Welcome to FIX.";
const FIX_TARGETS = ["fix.pair", "fix.in", "fix.trade", "fix.auto"] as const;
/** The card going out: `fix.out` when there are others to swipe to, `fix.out-only` when it is the line's one card. */
const fixOut = (page: Page) => page.locator('[data-tour="fix.out"], [data-tour="fix.out-only"]');
const fixPair = (page: Page) => page.getByRole("region", FIX_MOVE);
const fixSwapButton = (page: Page) => fixPair(page).getByRole("button", { name: /^Swap .+ for / });

async function openFixTour(page: Page) {
  await journeyWithoutTours(page);
  await openFix(page);
  await expect(tour(page)).toContainText(FIX_FIRST, { timeout: PAGE_WAIT_MS });
}

test("fix tour elements are on the page", async ({ page }) => {
  await openFixTour(page);
  await expect(tour(page)).toContainText("Fix");
  for (const target of FIX_TARGETS) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
  await expect(fixOut(page)).toBeVisible();
});

test("fix tour runs once", async ({ page }) => {
  await openFixTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  expect(await seen(page)).toContain("fix");
  await fixSwapButton(page).click();
  await expect(
    fixPair(page)
      .or(page.getByRole("button", { name: "Let's Go!" }))
      .first(),
  ).toBeVisible({ timeout: PAGE_WAIT_MS });
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(page.getByText(FIX_FIRST)).toHaveCount(0);
});

test.describe("fix tour by touch", () => {
  test.use({ hasTouch: true });

  test("fix tour: each swipe browses its own card, then Auto-Fix ends it", async ({ page }) => {
    await openFixTour(page);
    await expectRingOn(page, "fix.pair");
    // The card going out: a swipe step when the line has other cards to take out, a read when it has one (the mock
    // deck's first line: Lightning Bolt, off colour). A swipe browses and the tour waits for ›.
    await nextUntil(page, "This is the OUT card.");
    await page.waitForTimeout(TOUR_SETTLE_MS);
    if (await page.locator('[data-tour="fix.out-only"]').isVisible()) {
      await expectRingOn(page, "fix.out-only");
      await expect(tour(page)).not.toContainText("SWIPE");
    } else {
      const before = await fixSwapButton(page).getAttribute("aria-label");
      await swipeLit(page, "fix.out", -200, 0);
      await expect(fixSwapButton(page)).not.toHaveAttribute("aria-label", before!);
      await expect(tour(page)).toContainText("This is the OUT card.");
    }
    await nextUntil(page, "This is the IN card.");
    const afterOut = await fixSwapButton(page).getAttribute("aria-label");

    // A swipe on the card going in browses the cards to put in; the tour stays until ›.
    await swipeLit(page, "fix.in", -200, 0);
    await expect(fixSwapButton(page)).not.toHaveAttribute("aria-label", afterOut!);
    await expect(tour(page)).toContainText("This is the IN card.");
    await nextUntil(page, "Like the trade?");
    await expectRingOn(page, "fix.trade");

    await nextUntil(page, "TAP AUTO-FIX");
    await expectRingOn(page, "fix.auto");
    await page.locator('[data-tour="fix.auto"]').click();
    await expect(tour(page)).toBeHidden();
    expect(await seen(page)).toContain("fix");
  });
});

// Swap's tour (`swap`): the pair, the card going out, the card going in, then Skip and Swap. On desktop Deck stats'
// tour follows it.
const SWAP_TARGETS = ["swap.pair", "swap.out", "swap.in", "swap.decide"] as const;
const swapButton = (page: Page) => page.getByRole("region", { name: "Swipe through cards to replace" }).getByRole("button", { name: /^Swap in / });
const skipButton = (page: Page) => page.getByRole("region", { name: "Swipe through cards to replace" }).getByRole("button", { name: /^Skip / });

test("swap tour elements are on the page", async ({ page }) => {
  await journeyWithoutTours(page);
  await openSwapTour(page);
  await expect(tour(page)).toContainText("Swap");
  for (const target of SWAP_TARGETS) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
});

test.describe("swap tour by touch", () => {
  test.use({ hasTouch: true });

  test("swap tour: each swipe browses its own card, and Done ends it", async ({ page }) => {
    await journeyWithoutTours(page);
    await openSwapTour(page);
    await expectRingOn(page, "swap.pair");

    // A swipe on the card going out shows another card to upgrade; the tour waits for ›.
    await nextUntil(page, "This is your OUT card.");
    await expectRingOn(page, "swap.out");
    const before = await skipButton(page).getAttribute("aria-label");
    await swipeLit(page, "swap.out", -200, 0);
    await expect(skipButton(page)).not.toHaveAttribute("aria-label", before!);
    await expect(tour(page)).toContainText("This is your OUT card.");

    // A swipe on the card going in shows that card's next upgrade.
    await nextUntil(page, "This is your IN card.");
    await expect(swapButton(page)).toBeVisible({ timeout: PAGE_WAIT_MS });
    const option = await swapButton(page).getAttribute("aria-label");
    await swipeLit(page, "swap.in", -200, 0);
    await expect(swapButton(page)).not.toHaveAttribute("aria-label", option!);
    await nextUntil(page, "When you've found a SWAP you like");
    await expectRingOn(page, "swap.decide");

    // On a phone Done ends it: Deck stats' tour waits for a tap on its bar.
    await tour(page).getByRole("button", { name: "Done" }).click();
    await expect(tour(page)).toBeHidden();
    expect(await seen(page)).toContain("swap");
    await page.waitForTimeout(TOUR_SETTLE_MS);
    await expect(tour(page)).toBeHidden();
  });
});

// Finish's tour (`finish`): the score first, then the page's parts, Start over, and Save last (out of screen order).
// Its first words follow the score's level; the mock deck's is urgent.
const FINISH_FIRST = /YOU (DID|MADE) IT!/;
// Changes, Buy and the shopping list depend on the round; these are on every Finish.
const FINISH_TARGETS = ["finish.score.urgent", "finish.decklist", "finish.export", "finish.start-over", "finish.save"] as const;

/** On to Finish past Fix's and Swap's tours (on a phone no Deck stats' tour follows), to Finish's tour. */
async function openFinishTour(page: Page) {
  await journeyWithoutTours(page);
  await swapPastItsTour(page);
  await leaveSwap(page);
  await expect(tour(page)).toContainText(FINISH_FIRST, { timeout: PAGE_WAIT_MS });
}

test("finish tour elements are on the page", async ({ page }) => {
  await openFinishTour(page);
  await expect(tour(page)).toContainText("Finish");
  for (const target of FINISH_TARGETS) await expect(page.locator(`[data-tour="${target}"]`)).toBeVisible();
});

test("finish tour: the score first, then Save ends it and hands over to Save Deck", async ({ page }) => {
  await openFinishTour(page);
  await expectRingOn(page, "finish.score.urgent");
  await nextUntil(page, "COPY or DOWNLOAD");
  await expectRingOn(page, "finish.export");
  await nextUntil(page, "START OVER");
  await expectRingOn(page, "finish.start-over");
  await nextUntil(page, "TAP SAVE!");
  await expectRingOn(page, "finish.save");
  await page.locator('[data-tour="finish.save"]').click();
  await expect(tour(page)).toContainText(SAVE_DECK_FIRST, { timeout: PAGE_WAIT_MS });
  expect(await seen(page)).toContain("finish");
});

test("finish tour runs once", async ({ page }) => {
  await openFinishTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  expect(await seen(page)).toContain("finish");
  // Back to Swap through the stepper and on to Finish again.
  await page
    .getByRole("region", { name: "Recommendations" })
    .getByRole("navigation", { name: "Deck upgrade steps" })
    .getByRole("button", { name: "Swap" })
    .click();
  await leaveSwap(page);
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(page.getByText(FINISH_FIRST)).toHaveCount(0);
});

// The collection tour: the empty page only (a browser with no collection), one tap on Import.
const COLLECTION_FIRST = "IMPORT your COLLECTION from ManaBox";

async function openCollectionTour(page: Page) {
  await page.goto("/collection");
  await expect(tour(page)).toContainText(COLLECTION_FIRST, { timeout: PAGE_WAIT_MS });
}

test("collection tour: tapping Import opens the import page and ends it", async ({ page }) => {
  await openCollectionTour(page);
  await expect(tour(page)).toContainText("Collection");
  await expectRingOn(page, "collection.import");
  await page.locator('[data-tour="collection.import"]').click();
  await expect(page).toHaveURL(/\/collection\/import/);
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("collection");
});

test("collection tour runs once", async ({ page }) => {
  await openCollectionTour(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  expect(await seen(page)).toContain("collection");
  await page.reload();
  await expect(page.getByRole("heading", { name: "No collection yet" })).toBeVisible({ timeout: PAGE_WAIT_MS });
  await page.waitForTimeout(TOUR_SETTLE_MS);
  await expect(tour(page)).toHaveCount(0);
});
