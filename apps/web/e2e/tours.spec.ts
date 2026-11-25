import { TOURS_ENABLED_KEY, TOURS_SEEN_KEY } from "../src/lib/constants";
import { clearBuildBudget, expect, swipe, test, type Page } from "./fixtures";
import { mailpit, signIn } from "./mailpit";

// Every other spec runs with tours off (playwright.config.ts); these start from an empty browser, where they are on.
test.use({ storageState: { cookies: [], origins: [] } });

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

  await page.getByRole("button", { name: "Tutorials: What this does" }).click();
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

/** › until the bubble says `text`. */
async function nextUntil(page: Page, text: string) {
  await expect(async () => {
    if (!(await tour(page).innerText()).includes(text)) await tour(page).getByRole("button", { name: "Next step" }).click();
    await expect(tour(page)).toContainText(text, { timeout: 1_000 });
  }).toPass();
}

/** The lit ring sits on the element, the pad out from each edge. */
async function expectRingOn(page: Page, target: string) {
  await expect
    .poll(async () => {
      const ring = await page.locator("[data-tour-ring]").boundingBox();
      const element = await page.locator(`[data-tour="${target}"]`).boundingBox();
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

/** The bubble is inside the viewport and beside the element, not over it. */
async function expectBubbleBeside(page: Page, target: string) {
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const bubble = await tour(page).boundingBox();
      const element = await page.locator(`[data-tour="${target}"]`).boundingBox();
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
  // The Commander box is dimmed on this step: a tap on it neither focuses it nor takes typing.
  const box = (await commanderBox(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type("Chulane");
  await expect(commanderBox(page)).toHaveValue("");
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

  // The built deck's own tour lights Tune it.
  await expect(tour(page)).toContainText("fine tune this DECK", { timeout: PAGE_WAIT_MS });
  await expectRingOn(page, "build-result.tune");
  await tour(page).getByRole("button", { name: "Skip" }).click();
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
  await expect(tour(page)).not.toContainText("Once your list is in");
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

    // The swipe browses: another card, the deck's count unchanged, and the tour moves on.
    const before = await addButton(page).getAttribute("aria-label");
    const status = page.getByRole("region", { name: "Recommendations" }).getByText(/^\d+ \/ 100$/).first();
    const count = await status.innerText();
    await swipe(page.locator('[data-tour="add.card"]'), -200, 0);
    await expect(addButton(page)).not.toHaveAttribute("aria-label", before!);
    await expect(status).toHaveText(count);
    await expect(tour(page)).toContainText("STAT CHANGE PIPS");

    await nextUntil(page, "Green is GOOD!");
    await nextUntil(page, "TAP ADD to put it");
    await expectRingOn(page, "add.decide");
    await addButton(page).click();
    await expect(tour(page)).toBeHidden();
    expect(await seen(page)).toEqual(expect.arrayContaining(["journey", "add"]));
  });
});
