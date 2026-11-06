import { expect, test, type Locator, type Page } from "./fixtures";

/** Footer button of the docked readout; its name reads "Deck stats Mild, 5 of 17 in line". */
const FOOTER_NAME = /^Deck stats/;
/** The Add swipe's gesture buttons, "Add <card>" and "Skip <card>", inside its sitting. */
const ADD_CARD = /^Add /;
const SKIP_CARD = /^Skip /;
/** The Swap swipe's buttons, "Swap in <card>" and "Pass on <card>". */
const SWAP_IN = /^Swap in /;
const PASS_ON = /^Pass on /;
/** Rounding slack for comparing layout boxes, in CSS pixels. */
const LAYOUT_SLACK_PX = 1;
/** How far the touch test drags up the footer: past its SWIPE_OPEN_PX (24) and out of the bar. */
const SWIPE_TEST_PX = 80;

async function analyzeSample(page: Page) {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await expect(page.getByRole("region", { name: "Recommendations" })).toBeVisible({ timeout: 60_000 });
  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
}

/** Both buttons sit inside the viewport and above the Deck stats footer: the 390×844 rule in CLAUDE.md. */
async function expectAboveFooter(page: Page, buttons: Locator[]) {
  const viewport = page.viewportSize()!;
  const footerBox = (await page.getByRole("button", { name: FOOTER_NAME }).boundingBox())!;
  for (const button of buttons) {
    await expect(button).toBeVisible({ timeout: 60_000 });
    const box = (await button.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(Math.min(viewport.height, footerBox.y) + LAYOUT_SLACK_PX);
  }
}

test.describe("deck stats on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the footer opens the readout and leaves the swipe controls on screen", async ({ page }) => {
    await analyzeSample(page);
    const footer = page.getByRole("button", { name: FOOTER_NAME });
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/(OK|Mild|Urgent)/);
    // Colour rows join the count, so the total depends on the commander's colours.
    await expect(footer).toContainText(/\d+\/\d+/);

    await footer.click();
    const sheet = page.getByRole("dialog", { name: "Deck stats" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/^Compared with/)).toBeVisible();
    await sheet.getByRole("button", { name: "Close deck stats", exact: true }).click();
    await expect(sheet).toBeHidden();

    // Add swipe, the first step. The sample deck is short, so this also covers the open slots it has to fill.
    const sitting = page.getByRole("region", { name: "Cards to add" });
    await expectAboveFooter(page, [sitting.getByRole("button", { name: ADD_CARD }).first(), sitting.getByRole("button", { name: SKIP_CARD }).first()]);
  });

  test("the readout shows the colours estimate with the hardest cards to cast", async ({ page }) => {
    await analyzeSample(page);
    await page.getByRole("button", { name: FOOTER_NAME }).click();
    const sheet = page.getByRole("dialog", { name: "Deck stats" });
    const colours = sheet.getByRole("region", { name: "Colours" });
    await expect(colours).toBeVisible();
    await expect(colours.getByText("Estimate")).toBeVisible();
    await expect(colours.getByText(/ sources$/).first()).toBeVisible();
    await expect(colours.getByText(/3 by turn 3/)).toBeVisible();
    const hard = colours.getByRole("listitem").filter({ hasText: /% · turn \d+$/ });
    await expect(hard.first()).toBeVisible();
    await expect(hard.first().locator("img")).toBeVisible();
    await colours.getByRole("button", { name: "About the colour estimate" }).click();
    await expect(page.getByRole("link", { name: "Karsten's article" })).toBeVisible();
  });

  test("the Swap step keeps both rows and its buttons above the footer", async ({ page }) => {
    await analyzeSample(page);
    const recs = page.getByRole("region", { name: "Recommendations" });
    // Swap opens once Cut has been reached; the sample's mandatory cut can stay for this.
    const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
    await steps.getByRole("button", { name: "Cut" }).click();
    // The sample is short of 100, so leaving Add asks first.
    await page.getByRole("dialog", { name: "Deck Under 100" }).getByRole("button", { name: "Continue" }).click();
    await steps.getByRole("button", { name: "Swap" }).click();

    const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
    const swapIn = rater.getByRole("button", { name: SWAP_IN });
    const nothingLeft = recs.getByRole("button", { name: "Next: finish" });
    await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: 20_000 });
    test.skip(await nothingLeft.isVisible(), "no replacements in this data");
    await expectAboveFooter(page, [swapIn, rater.getByRole("button", { name: PASS_ON })]);
  });
});

test.describe("deck stats on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the rail is open beside the journey", async ({ page }) => {
    await analyzeSample(page);
    await expect(page.getByRole("complementary", { name: "Deck stats" })).toBeVisible();
    await expect(page.getByRole("button", { name: FOOTER_NAME })).toBeHidden();
  });
});
