import { expect, test, type Page } from "@playwright/test";

/** Footer button of the docked readout; its name reads "Deck stats Mild, 5 of 8 in line". */
const FOOTER_NAME = /^Deck stats/;
/** The Cut swipe's gesture buttons, "Cut <card>" and "Keep <card>"; not the "Cut the rest and move on" link under them. */
const CUT_CARD = /^Cut (?!the rest and move on$)/;
const KEEP_CARD = /^Keep /;
/** Rounding slack for comparing layout boxes, in CSS pixels. */
const LAYOUT_SLACK_PX = 1;

async function analyzeSample(page: Page) {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await expect(page.getByRole("region", { name: "Recommendations" })).toBeVisible({ timeout: 60_000 });
  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
}

test.describe("deck stats on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the footer opens the readout and leaves the swipe controls on screen", async ({ page }) => {
    await analyzeSample(page);
    const footer = page.getByRole("button", { name: FOOTER_NAME });
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/(OK|Mild|Urgent)/);
    await expect(footer).toContainText(/\d+\/8/);

    await footer.click();
    const sheet = page.getByRole("dialog", { name: "Deck stats" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/^Compared with/)).toBeVisible();
    await sheet.getByRole("button", { name: "Close deck stats", exact: true }).click();
    await expect(sheet).toBeHidden();

    // Cut swipe: both gesture buttons sit inside the viewport and above the footer.
    const viewport = page.viewportSize()!;
    const footerBox = (await footer.boundingBox())!;
    for (const name of [CUT_CARD, KEEP_CARD]) {
      const button = page.getByRole("button", { name }).first();
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(Math.min(viewport.height, footerBox.y) + LAYOUT_SLACK_PX);
    }
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
