import { clearBuildBudget, expect, fillDecklist, ignoreBuildGaps, openSwap, test, type Locator, type Page } from "./fixtures";

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
  await page.getByLabel("Collection import").fill(SMALL_COLLECTION);
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: COLLECTION_WAIT_MS });

  // The build takes every owned card it can and leaves the rest open.
  await page.goto("/deck?start=build");
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: COLLECTION_WAIT_MS });
  await clearBuildBudget(page);
  await page.getByRole("button", { name: "Build deck" }).click();
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(built.getByText(/^\d+ match(es)?$/)).toBeVisible();
  // A line the collection couldn't fill asks for an answer before Tune it opens.
  await ignoreBuildGaps(page);
  await built.getByRole("button", { name: "Tune it" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: RECS_WAIT_MS });
  const count = recs.getByRole("status").getByText(/^\d+ \/ 100$/).first();
  await expect(count).not.toHaveText("100 / 100", { timeout: RECS_WAIT_MS });

  // Kept to owned cards, Add has nothing left to suggest.
  await page.getByRole("combobox", { name: "My collection" }).click();
  await page.getByRole("option", { name: "Owned only" }).click();
  await expect(recs.getByText("Insufficient Collection")).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(recs.getByText("You don't have a large enough collection.")).toBeVisible();

  // Leaving for Fix under 100 asks first; keeping on stays in Add.
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  await steps.getByRole("button", { name: "Fix" }).click();
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
  await recs.getByRole("group", { name: "This round" }).getByRole("button", { name: "Undo" }).click();
  await expect(count).toHaveText(before);

  // Allow Singles switches the collection setting to Owned first, and Add deals cards to buy, with their price.
  await recs.getByRole("button", { name: "Allow Singles" }).click();
  await expect(page.getByRole("combobox", { name: "My collection" })).toHaveText(/Owned first/);
  const sitting = recs.getByRole("region", { name: "Cards to add" });
  await expectAboveFooter(page, [sitting.getByRole("button", { name: /^Add / }).first(), sitting.getByRole("button", { name: /^Skip / }).first()]);
  await expect(sitting.getByText(/^\$/)).toBeVisible();
});

test("a collection build asks about each gap: Allow buying adds cards to buy, Ignore leaves the line out (T089)", async ({ page }) => {
  await page.goto("/collection/import");
  await page.getByLabel("Collection import").fill(SMALL_COLLECTION);
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: COLLECTION_WAIT_MS });

  await page.goto("/deck?start=build");
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: COLLECTION_WAIT_MS });
  await clearBuildBudget(page);
  await page.getByRole("button", { name: "Build deck" }).click();
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: RECS_WAIT_MS });

  // Tune it waits for an answer to every line the collection ran out of.
  const gaps = built.getByRole("list", { name: "What your collection ran out of" });
  const answers = gaps.getByRole("group").first();
  // The line's name comes once the built deck's stats are in; until then it reads "A Deck stats line".
  await expect(answers).not.toHaveAttribute("aria-label", /^A Deck stats line/, { timeout: RECS_WAIT_MS });
  const label = (await answers.getAttribute("aria-label"))!.replace(/: ignore it or allow buying$/, "");
  await expect(built.getByRole("button", { name: "Tune it" })).toBeDisabled();
  await expect(built.getByText("Choose Ignore or Allow buying for each to go on.")).toBeVisible();

  // Allow buying builds again with cards the collection lacks, each marked with its price, and the cost to buy them.
  await answers.getByRole("button", { name: "Allow buying" }).click();
  await expect(answers.getByRole("button", { name: "Allow buying" })).toHaveAttribute("aria-pressed", "true", { timeout: RECS_WAIT_MS });
  await expect(built.getByText(/^Not owned · /).first()).toBeVisible({ timeout: RECS_WAIT_MS });
  // The cart leads the actions: what the cards to buy cost, and Buy on TCGplayer beside Tune it (T102).
  await expect(built.getByText(/^\d+ cards? to buy, \$/)).toBeVisible();
  await expect(built.getByRole("link", { name: /^Buy on TCGplayer/ }).first()).toBeVisible();

  // Ignore builds from the collection alone again; the line stays listed so the answer can still change.
  await answers.getByRole("button", { name: "Ignore", exact: true }).click();
  await expect(answers.getByRole("button", { name: "Ignore", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: RECS_WAIT_MS });
  await expect(built.getByText(/^Not owned · /)).toHaveCount(0, { timeout: RECS_WAIT_MS });
  // The collection supplies every card now: no Buy at all, never a greyed one.
  await expect(built.getByText(/^\d+ cards? to buy, \$/)).toHaveCount(0);
  await expect(built.getByText("You own every card.")).toBeVisible();
  await expect(built.getByRole("link", { name: /^Buy on TCGplayer/ })).toHaveCount(0);
  await ignoreBuildGaps(page);
  await built.getByRole("button", { name: "Tune it" }).click();

  // In Deck stats the ignored line is grey, marked Ignored, and out of the score; a refresh brings the answer back.
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: RECS_WAIT_MS });
  const ignoredLine = async () => {
    await page.getByRole("button", { name: FOOTER_NAME }).click();
    const sheet = page.getByRole("dialog", { name: "Deck stats" });
    // Each line is a ring named "<line>: <count>, <where it stands>".
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ring = sheet.getByRole("button", { name: new RegExp(`^${escaped}: \\d+, ignored`) });
    const line = sheet.getByRole("listitem").filter({ has: ring }).first();
    await expect(line.getByRole("img", { name: "Ignored" })).toBeVisible({ timeout: RECS_WAIT_MS });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  };
  await ignoredLine();
  await page.reload();
  await page.getByRole("dialog", { name: /^Continue with / }).getByRole("button", { name: "Yes" }).click();
  await expect(recs).toBeVisible({ timeout: RECS_WAIT_MS });
  await ignoredLine();
});

test("owned suggestions carry the corner marker where they mix with cards to buy, and none in Owned only", async ({ page }) => {
  await page.goto("/collection/import");
  await page.getByLabel("Collection import").fill(
    // Creatures near the top of Chulane's Add list in the mocks and the real catalog alike, and no Game Changers,
    // which a low bracket leaves out.
    ["1 Chulane, Teller of Tales", "1 Birds of Paradise", "1 Llanowar Elves", "1 Elvish Mystic", "1 Beast Whisperer"].join("\n"),
  );
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: COLLECTION_WAIT_MS });

  await page.goto("/deck");
  await fillDecklist(page, ["Commander", "1 Chulane, Teller of Tales", "", "Deck", "1 Sol Ring", "1 Command Tower"].join("\n"));
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

test("the build start's budget starts at each list's default and remembers what was typed under it", async ({ page }) => {
  await page.goto("/collection/import");
  await page.getByLabel("Collection import").fill(SMALL_COLLECTION);
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: COLLECTION_WAIT_MS });

  await page.goto("/deck?start=build");
  const perCard = page.getByRole("textbox", { name: "Max per card" });
  const spend = page.getByRole("textbox", { name: "Max to spend" });
  const lists = page.getByRole("group", { name: "Which commanders to list" });
  // From my collection: $0 each, so the build sticks to owned cards until the player says otherwise.
  await expect(perCard).toHaveValue("0", { timeout: COLLECTION_WAIT_MS });
  await expect(spend).toHaveValue("0");
  // Any commander: $10 a card, $100 in all.
  await lists.getByRole("button", { name: "Any commander" }).click();
  await expect(perCard).toHaveValue("10");
  await expect(spend).toHaveValue("100");
  await perCard.fill("25");
  await lists.getByRole("button", { name: "From my collection" }).click();
  await expect(perCard).toHaveValue("0");

  // A later visit gets back what was typed under each list.
  await page.reload();
  await expect(perCard).toHaveValue("0", { timeout: COLLECTION_WAIT_MS });
  await lists.getByRole("button", { name: "Any commander" }).click();
  await expect(perCard).toHaveValue("25");
  await expect(spend).toHaveValue("100");
});

test("a built deck shows its bracket estimate, and a card's score on tap", async ({ page }) => {
  await page.goto("/deck?start=build");
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: COLLECTION_WAIT_MS });
  await clearBuildBudget(page);
  await page.getByRole("button", { name: "Build deck" }).click();
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(built.getByText(/^(Over bracket|Bracket) \d\s*Estimated$/)).toBeVisible();
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

test("a refresh after Tune it offers the deck back with its choices", async ({ page }) => {
  await page.goto("/deck?start=build");
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: COLLECTION_WAIT_MS });
  await clearBuildBudget(page);
  await page.getByRole("button", { name: "Build deck" }).click();
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: RECS_WAIT_MS });
  await built.getByRole("button", { name: "Tune it" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: RECS_WAIT_MS });
  await expect(page).toHaveURL(/\/deck$/);
  const ask = page.getByRole("dialog", { name: /^Continue with / });
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  if ((await steps.getByRole("button").first().innerText()).trim() !== "Add") {
    // The real catalog's build is a full deck, so its round has no Add: the choice to bring back is a swap.
    await openSwap(page);
    const swapIn = recs.getByRole("region", { name: "Swipe through cards to replace" }).getByRole("button", { name: /^Swap in / });
    const nothingLeft = recs.getByRole("button", { name: "Next: finish" });
    await expect(swapIn.or(nothingLeft)).toBeVisible({ timeout: RECS_WAIT_MS });
    test.skip(await nothingLeft.isVisible(), "no replacements in this data, so no choice to bring back");
    await swapIn.click();
    const swaps = recs.getByRole("list", { name: "Swaps picked" }).getByRole("button");
    await expect(swaps).toHaveCount(1);
    await page.reload();
    await ask.getByRole("button", { name: "Yes" }).click();
    await expect(swaps).toHaveCount(1, { timeout: RECS_WAIT_MS });
    return;
  }
  const count = recs.getByRole("status").getByText(/^\d+ \/ 100$/).first();
  // The mocks' build is short and has no card to add, so it offers basics for the holes.
  const addIt = recs.getByRole("region", { name: "Cards to add" }).getByRole("button", { name: /^Add / }).first();
  const fill = recs.getByRole("button", { name: /^Add \d+ basics?$/ });
  await expect(addIt.or(fill).first()).toBeVisible({ timeout: RECS_WAIT_MS });
  const before = Number((await count.innerText()).split(" / ")[0]);
  const viaFill = await fill.isVisible();
  const after = viaFill ? "100 / 100" : `${before + 1} / 100`;
  await (viaFill ? fill : addIt).click();
  await expect(count).toHaveText(after, { timeout: RECS_WAIT_MS });

  await page.reload();
  await ask.getByRole("button", { name: "Yes" }).click();
  await expect(count).toHaveText(after, { timeout: RECS_WAIT_MS });
});
