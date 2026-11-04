import { expect, test, type Locator, type Page } from "@playwright/test";

/** Collection parsing and catalog loading may take this long in the production mock build. */
const COLLECTION_WAIT_MS = 30_000;
/** A build or a recommendation list on a cold server. */
const RECS_WAIT_MS = 90_000;
/** Footer button of the docked readout; its name reads "Deck stats Mild, 5 of 8 in line". */
const FOOTER_NAME = /^Deck stats/;
/** Rounding slack for comparing layout boxes, in CSS pixels. */
const LAYOUT_SLACK_PX = 1;
/** A collection far too small for a deck: the commander, two rocks and a land. */
const SMALL_COLLECTION = ["1 Chulane, Teller of Tales", "1 Sol Ring", "1 Arcane Signet", "1 Command Tower"].join("\n");

/** Both buttons sit inside the viewport and above the Deck stats footer: the 390×844 rule in CLAUDE.md. */
async function expectAboveFooter(page: Page, buttons: Locator[]) {
  const viewport = page.viewportSize()!;
  const footerBox = (await page.getByRole("button", { name: FOOTER_NAME }).boundingBox())!;
  for (const button of buttons) {
    await expect(button).toBeVisible({ timeout: RECS_WAIT_MS });
    const box = (await button.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(Math.min(viewport.height, footerBox.y) + LAYOUT_SLACK_PX);
  }
}

test.use({ viewport: { width: 390, height: 844 } });

test("a short collection build: Add runs out, offers singles, then basics for the holes (T076)", async ({ page }) => {
  await page.goto("/collection/import");
  await page.getByLabel("Collection export").fill(SMALL_COLLECTION);
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: COLLECTION_WAIT_MS });

  // The build takes every owned card it can and leaves the rest open.
  await page.goto("/deck?start=build");
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: COLLECTION_WAIT_MS });
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(built.getByText(/^\d+ match(es)?$/)).toBeVisible();
  await built.getByRole("button", { name: "Continue" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: RECS_WAIT_MS });
  const count = recs.getByRole("status").getByText(/^\d+ \/ 100$/).first();
  await expect(count).not.toHaveText("100 / 100", { timeout: RECS_WAIT_MS });

  // Kept to owned cards, Add has nothing left to suggest.
  await page.getByRole("combobox", { name: "My collection" }).click();
  await page.getByRole("option", { name: "Owned only" }).click();
  await expect(recs.getByText("Insufficient Collection")).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(recs.getByText("You don't have a large enough collection.")).toBeVisible();

  // Leaving for Cut under 100 asks first; keeping on stays in Add.
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await steps.getByRole("button", { name: "Cut" }).click();
  const leave = page.getByRole("dialog", { name: "Deck Under 100" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Keep adding" }).click();
  await expect(leave).toBeHidden();
  await expect(steps.getByRole("button", { name: "Add" })).toHaveAttribute("aria-current", "step");

  // Owned only: basic lands fill every hole in one choice, which Undo takes back.
  await recs.getByRole("button", { name: "Owned only" }).click();
  const fill = recs.getByRole("button", { name: /^Add \d+ basics?$/ });
  await expect(fill).toBeVisible();
  const before = await count.innerText();
  await fill.click();
  await expect(count).toHaveText("100 / 100", { timeout: RECS_WAIT_MS });
  await recs.getByRole("toolbar", { name: "This round" }).getByRole("button", { name: "Undo" }).click();
  await expect(count).toHaveText(before);

  // Allow Singles switches the collection setting to Owned first, and Add deals cards to buy, with their price.
  await recs.getByRole("button", { name: "Allow Singles" }).click();
  await expect(page.getByRole("combobox", { name: "My collection" })).toHaveText(/Owned first/);
  const sitting = recs.getByRole("region", { name: "Cards to add" });
  await expectAboveFooter(page, [sitting.getByRole("button", { name: /^Add / }).first(), sitting.getByRole("button", { name: /^Skip / }).first()]);
  await expect(sitting.getByText(/^About \$/)).toBeVisible();
});

test("owned suggestions carry the corner marker where they mix with cards to buy, and none in Owned only", async ({ page }) => {
  await page.goto("/collection/import");
  await page.getByLabel("Collection export").fill(
    // Creatures near the top of Chulane's Add list in the mocks and the real catalog alike, and no Game Changers,
    // which a low bracket leaves out.
    ["1 Chulane, Teller of Tales", "1 Birds of Paradise", "1 Llanowar Elves", "1 Elvish Mystic", "1 Beast Whisperer"].join("\n"),
  );
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: COLLECTION_WAIT_MS });

  await page.goto("/deck");
  await page.getByRole("textbox", { name: "Decklist" }).fill(["Commander", "1 Chulane, Teller of Tales", "", "Deck", "1 Sol Ring", "1 Command Tower"].join("\n"));
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: RECS_WAIT_MS });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  const mode = page.getByRole("combobox", { name: "My collection" });
  await expect(mode).toHaveText("Owned first", { timeout: RECS_WAIT_MS });
  await page.getByRole("button", { name: "Show as a list" }).click();
  const adds = recs.getByRole("list", { name: "Cards to add" });
  await expect(adds.getByRole("img", { name: "Owned" }).first()).toBeVisible({ timeout: RECS_WAIT_MS });

  await mode.click();
  await page.getByRole("option", { name: "Owned only" }).click();
  await expect(mode).toHaveText("Owned only");
  await expect(adds.getByRole("button").first()).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(adds.getByRole("img", { name: "Owned" })).toHaveCount(0);
});

test("a built deck shows its bracket estimate, and a card's score on tap", async ({ page }) => {
  await page.goto("/deck?start=build");
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: COLLECTION_WAIT_MS });
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(built.getByText(/^(Over bracket|Bracket) \d/)).toBeVisible();
  await expect(built.getByText("Estimated", { exact: true })).toBeVisible();

  await built.getByRole("list", { name: "Creatures" }).getByRole("button").first().click();
  const zoom = page.getByRole("dialog", { name: /, enlarged$/ });
  await expect(zoom).toBeVisible();
  await expect(zoom.getByRole("button", { name: "Close" })).toHaveCount(0);
  await zoom.getByText("Why this card").click();
  await expect(zoom.getByText(/of the score$/).first()).toBeVisible();
  await expect(zoom.getByText(/^Not counted/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(zoom).toBeHidden();
});
