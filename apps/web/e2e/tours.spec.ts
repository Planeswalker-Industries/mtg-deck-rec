import { TOURS_ENABLED_KEY, TOURS_SEEN_KEY } from "../src/lib/constants";
import { clearBuildBudget, expect, test, type Page } from "./fixtures";
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
  await expect(tour(page)).toContainText("So you want to build a Commander deck, huh?", { timeout: PAGE_WAIT_MS });
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
  await nextUntil(page, "Import your collection first");
  // The Commander box is dimmed on this step: a tap on it neither focuses it nor takes typing.
  const box = (await commanderBox(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type("Chulane");
  await expect(commanderBox(page)).toHaveValue("");
  await expect(tour(page)).toContainText("Import your collection first");
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
  await nextUntil(page, "Import your collection first");
  await nextUntil(page, "type part of your commander's name");
  await expectBubbleBeside(page, "build-start.commander");

  // The lit box takes typing; once a commander is picked, the step lights the plate in its place.
  await commanderBox(page).fill("Chulane");
  await page
    .getByRole("option", { name: /Chulane/ })
    .first()
    .click({ timeout: PAGE_WAIT_MS });
  await expect(tour(page)).toContainText("Here's your commander");

  await nextUntil(page, "pick 3!");
  await nextUntil(page, "Don't want a $10,000 deck?");
  await clearBuildBudget(page);
  await nextUntil(page, "off to the races");

  await page.getByRole("button", { name: "Build deck" }).click();
  await expect(tour(page)).toBeHidden();
  expect(await seen(page)).toContain("build-start");
  await expect(page.getByRole("region", { name: "Your built deck" })).toBeVisible({ timeout: BUILD_WAIT_MS });
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
