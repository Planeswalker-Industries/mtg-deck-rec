import { expect, test, type Locator, type Page } from "@playwright/test";

/** Analyzes the sample deck and switches to the deckbuilder. Returns the recommendations region. */
async function openDeckbuilder(page: Page) {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  await recs.getByRole("button", { name: "Deckbuilder" }).click();
  return recs;
}

/** Opens the deckbuilder's card search: its own tab on a phone, beside the deck on a wide screen. */
async function openCardSearch(page: Page) {
  const recs = await openDeckbuilder(page);
  const addTab = recs.getByRole("button", { name: "Add cards" });
  if (await addTab.isVisible()) await addTab.click();
  return { recs, search: recs.getByRole("region", { name: "Add cards" }) };
}

test("analyzes the sample deck, and the deckbuilder swaps a card for a replacement", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // The upgrade journey is what opens; the deckbuilder is the other mode.
  await expect(recs.getByRole("button", { name: "Upgrade" })).toHaveAttribute("aria-pressed", "true");

  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  const notNow = page.getByRole("dialog").getByRole("button", { name: "Not now" });
  await notNow.click({ timeout: 3_000 }).catch(() => undefined);

  await recs.getByRole("button", { name: "Deckbuilder" }).click();
  const deckList = recs.getByRole("region", { name: "Deck list" });
  const replace = deckList.getByRole("button", { name: /^Replace / }).first();
  await expect(replace).toBeVisible({ timeout: 60_000 });
  const target = ((await replace.getAttribute("aria-label")) ?? "").replace(/^Replace /, "");
  await replace.click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: `Replace ${target}` })).toBeVisible();
  await expect(sheet.getByText("Cards that do the same job, best fit first.")).toBeVisible();
  const swapIn = sheet.getByRole("button", { name: /^Swap in / });
  const nothing = sheet.getByText(/can't suggest replacements|No legal replacements|Nothing in your collection/);
  await expect(swapIn.or(nothing)).toBeVisible({ timeout: 60_000 });
  if (await nothing.isVisible()) return;

  // Swapping puts the replacement in the deck in the card's place.
  const replacement = ((await swapIn.innerText()) ?? "").replace(/^Swap in /, "");
  await swapIn.click();
  await expect(sheet).toBeHidden();
  await expect(deckList.getByRole("button", { name: `Remove ${replacement}` })).toBeVisible();
  await expect(deckList.getByRole("button", { name: `Remove ${target}` })).toHaveCount(0);
});

test("the deckbuilder adds a card from search, within the commander's colours", async ({ page }) => {
  const { search } = await openCardSearch(page);
  await search.getByRole("button", { name: "Creatures" }).click();
  const results = search.getByRole("list", { name: "Search results" });
  const add = results.getByRole("button", { name: /^Add / }).first();
  await expect(add).toBeVisible({ timeout: 60_000 });
  const name = ((await add.getAttribute("aria-label")) ?? "").replace(/^Add /, "");
  await add.click();
  // Once in, the card can't be added twice.
  await expect(results.getByRole("button", { name: `${name} is in the deck` })).toBeVisible();
});

test("the deckbuilder search shows nothing once the name box is emptied", async ({ page }) => {
  const { search } = await openCardSearch(page);
  const box = search.getByRole("searchbox", { name: "Card name" });
  const results = search.getByRole("list", { name: "Search results" });

  await box.fill("sol");
  await expect(results).toBeVisible({ timeout: 60_000 });
  // One letter is not a search, and the commander's colours alone are not either.
  await box.fill("s");
  await expect(results).toBeHidden();
  await box.fill("sol");
  await expect(results).toBeVisible({ timeout: 60_000 });
  await box.fill("");
  await expect(results).toBeHidden();
  await expect(search.getByText(/^Type a card name/)).toBeVisible();
});

/** The deck bar's bottom edge, which a stuck filter block must sit at or below. */
async function deckBarBottom(page: Page) {
  const bar = await page.locator("[data-deck-bar]").boundingBox();
  if (!bar) throw new Error("deck bar not on screen");
  return bar.y + bar.height;
}

/** Rounding slack for comparing layout boxes, in CSS pixels. */
const LAYOUT_SLACK_PX = 1;

test("the deckbuilder search filters stay on screen while a phone scrolls the results", async ({ page }) => {
  const { search } = await openCardSearch(page);
  await search.getByRole("button", { name: "Instants" }).click();
  await expect(search.getByRole("list", { name: "Search results" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });

  const types = search.getByRole("group", { name: "Card type" });
  const before = await types.boundingBox();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // Precondition: the page scrolled past where the filters started, so staying visible means they stuck.
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before?.y ?? 0);

  await expect(types).toBeInViewport();
  const after = await types.boundingBox();
  expect(after?.y ?? 0).toBeGreaterThanOrEqual((await deckBarBottom(page)) - LAYOUT_SLACK_PX);
  // The pill rows scroll inside themselves; the page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the deckbuilder search filters stay on screen while the sidebar scrolls the results", async ({ page }) => {
    const { search } = await openCardSearch(page);
    await search.getByRole("button", { name: "Instants" }).click();
    await expect(search.getByRole("list", { name: "Search results" }).getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });

    const sidebar = search.locator("xpath=ancestor::aside[1]");
    const scrolled = await sidebar.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    // Precondition: the sidebar has more results than fit, so there was something to scroll.
    expect(scrolled).toBeGreaterThan(0);

    const types = search.getByRole("group", { name: "Card type" });
    await expect(types).toBeInViewport();
    const box = await types.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThanOrEqual((await deckBarBottom(page)) - LAYOUT_SLACK_PX);
  });
});

test("remembers the list view for the next visit", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  await recs.getByRole("button", { name: "List" }).click();

  // The deck and the view both come back after a reload: the Cut phase opens as the list of the whole deck.
  await page.reload();
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await expect(recs.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await expect(recs.getByRole("region", { name: "Your deck" })).toBeVisible({ timeout: 60_000 });
});

test("takes a decklist as a file, and reduces a CSV export to quantities and names", async ({ page }) => {
  await page.goto("/deck");

  // An Archidekt-shaped deck CSV: printings and finishes, which a deck doesn't care about.
  const csv = [
    "Quantity,Name,Finish,Edition Code,Collector Number,Condition",
    "1,Sol Ring,Normal,C21,263,NM",
    "1,Sol Ring,Foil,LTC,284,NM",
    '1,"Liesa, Forgotten Archangel",Normal,MID,238,NM',
  ].join("\n");

  await page.locator("input[type=file]").setInputFiles({ name: "deck.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  // The two Sol Ring rows are one card the deck runs twice; the printings are gone.
  await expect(page.getByRole("textbox", { name: "Decklist" })).toHaveValue("2 Sol Ring\n1 Liesa, Forgotten Archangel");
});

test("explains why a replacement was suggested, and the shares add up", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  await recs.getByRole("button", { name: "Deckbuilder" }).click();
  await recs.getByRole("region", { name: "Deck list" }).getByRole("button", { name: /^Replace / }).first().click({ timeout: 60_000 });

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: /^Replace / })).toBeVisible();
  const why = sheet.getByText("Why this card");
  await expect(why).toBeVisible({ timeout: 60_000 });
  await why.click();

  // Every component that counted names its share, and those shares are the whole score.
  const panel = sheet.locator("details[open]");
  const shares = await panel.getByText(/% of the score$/).allInnerTexts();
  expect(shares.length).toBeGreaterThan(0);
  const total = shares.reduce((sum, text) => sum + Number(text.replace(/\D/g, "")), 0);
  // Each share is rounded to a whole percent, so the sum lands within a point per row.
  expect(Math.abs(total - 100)).toBeLessThanOrEqual(shares.length);
});

test("offers to start from a collection when there isn't one", async ({ page }) => {
  await page.goto("/deck");
  const link = page.getByRole("link", { name: "Import your collection first" });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await page.waitForURL(/\/collection\/import$/);
});

test("a name search's next page continues the list rather than repeating it", async ({ request }) => {
  const page = async (offset: number) => {
    const res = await request.get(`/api/cards/search?q=angel&limit=5&offset=${offset}`);
    const body = (await res.json()) as { ok: boolean; data: { id: number }[] };
    expect(body.ok).toBe(true);
    return body.data.map((c) => c.id);
  };
  const first = await page(0);
  // CI's database has no catalog, so there is nothing to page there.
  test.skip(first.length === 0, "no catalog loaded");
  const second = await page(first.length);
  expect(second.filter((id) => first.includes(id))).toEqual([]);
});

/**
 * Checks that, in every row of a card grid, the first button matching `button` in each card sits at the same height.
 * Rows are found from the cards' own top edges, so the check holds whatever the column count.
 */
async function expectButtonsAligned(list: Locator, button: RegExp) {
  const items = list.getByRole("listitem");
  const count = await items.count();
  const rows = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const [itemBox, buttonBox] = await Promise.all([item.boundingBox(), item.getByRole("button", { name: button }).first().boundingBox()]);
    if (!itemBox || !buttonBox) continue;
    const row = Math.round(itemBox.y);
    rows.set(row, [...(rows.get(row) ?? []), buttonBox.y]);
  }
  expect(rows.size).toBeGreaterThan(0);
  for (const ys of rows.values()) expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(LAYOUT_SLACK_PX);
}

test("the deckbuilder's search results line up their Add buttons", async ({ page }) => {
  const { search } = await openCardSearch(page);
  await search.getByRole("button", { name: "Instants" }).click();
  const results = search.getByRole("list", { name: "Search results" });
  await expect(results.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expectButtonsAligned(results, /^Add |is in the deck$/);
});

test("the deckbuilder's deck cards line up their buttons", async ({ page }) => {
  const recs = await openDeckbuilder(page);
  const deckList = recs.getByRole("region", { name: "Deck list" });
  await expect(deckList.getByRole("button", { name: /^Remove / }).first()).toBeVisible({ timeout: 60_000 });
  // Every group in the deck, commanders included.
  const grids = deckList.getByRole("list");
  for (let i = 0; i < (await grids.count()); i++) await expectButtonsAligned(grids.nth(i), /^Remove /);
});
