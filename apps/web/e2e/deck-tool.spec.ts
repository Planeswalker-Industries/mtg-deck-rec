import { expect, test, type Page } from "@playwright/test";

/** Tailwind's `lg` breakpoint, where the deckbuilder shows search beside the deck instead of its own tab. */
const LG_BREAKPOINT_PX = 1024;

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
  const width = page.viewportSize()?.width ?? 0;
  if (width < LG_BREAKPOINT_PX) await recs.getByRole("button", { name: "Add cards" }).click();
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

test("the deckbuilder adds the only search result on Enter, then empties the box for the next card", async ({ page }) => {
  const { recs, search } = await openCardSearch(page);
  const results = search.getByRole("list", { name: "Search results" });
  // A creature the deck doesn't run yet, found by browsing, then typed in full so it is the only result.
  await search.getByRole("button", { name: "Creatures" }).click();
  const add = results.getByRole("button", { name: /^Add / }).first();
  await expect(add).toBeVisible({ timeout: 60_000 });
  const name = ((await add.getAttribute("aria-label")) ?? "").replace(/^Add /, "");
  await search.getByRole("group", { name: "Card type" }).getByRole("button", { name: "All" }).click();

  const box = search.getByRole("searchbox", { name: "Card name" });
  await box.fill(name);
  await expect(results.getByRole("listitem")).toHaveCount(1, { timeout: 60_000 });
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  // On a phone the deck list is the other tab, so it is looked for hidden too.
  const deckList = recs.getByRole("region", { name: "Deck list", includeHidden: true });
  await expect(deckList.getByRole("button", { name: `Remove ${name}`, includeHidden: true })).toBeAttached();
});

test("the deckbuilder's land buttons add a basic land in the commander's colours", async ({ page }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "the mock catalog has no basic lands (E2E_LOCAL_DATA)");
  const { recs, search } = await openCardSearch(page);
  const button = search.getByRole("group", { name: "Add a basic land" }).getByRole("button").first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  const land = ((await button.getAttribute("aria-label")) ?? "").replace(/^Add a /, "");
  // On a phone the deck list is the other tab, so it is looked for hidden too.
  const deckList = recs.getByRole("region", { name: "Deck list", includeHidden: true });
  const copies = deckList.getByRole("button", { name: `One more ${land}`, includeHidden: true }).locator("xpath=..").getByLabel(/ copies$/);
  const before = (await copies.count()) > 0 ? Number(await copies.textContent()) : 0;
  await button.click();
  await expect(copies).toHaveText(String(before + 1));
});

test("the deckbuilder search shows nothing once the name box is emptied, and Clear empties it", async ({ page }) => {
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

  // Clear does the same, and hands the box focus back.
  await box.fill("sol");
  await search.getByRole("button", { name: "Clear" }).click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
});

test("puts the last decklist back in the box without analyzing it, and remembers the list view", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  await recs.getByRole("button", { name: "Show as a list" }).click();

  // A reload brings the deck back into the box and asks whether to carry on: opening the tool never analyzes an old
  // deck by itself. Waving the question away leaves the deck in the box.
  await page.reload();
  const resume = page.getByRole("dialog", { name: /^Continue with .+\?$/ });
  await expect(resume).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(resume).toBeHidden();
  const box = page.getByRole("textbox", { name: "Decklist" });
  await expect(box).not.toHaveValue("", { timeout: 30_000 });
  const note = page.getByText("Your last decklist is back in the box.");
  await expect(note).toBeVisible();
  await expect(recs).toBeHidden();

  // Editing the restored text hides the note: it stops describing the box the moment the box changes.
  const restoredText = await box.inputValue();
  await box.press("End");
  await box.type("\n");
  await expect(note).toBeHidden();
  // Putting the exact restored text back brings the note back, before analyzing.
  await box.fill(restoredText);
  await expect(note).toBeVisible();

  // Analyzing it picks up where the player left off, list view included.
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  // On a phone the view toggle now offers the swipe view back.
  await expect(recs.getByRole("button", { name: "Swipe one card at a time" })).toBeVisible();
  await expect(recs.getByRole("list", { name: "Cards to add" })).toBeVisible({ timeout: 60_000 });

  // Clearing the box forgets it, and the note goes with it.
  await page.getByRole("button", { name: "Edit decklist" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(box).toHaveValue("");
  await expect(page.getByText("Your last decklist is back in the box.")).toBeHidden();
});

test("asks whether to carry on with the last deck: yes analyzes it, no starts a new one", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  // The question names the deck by its commander.
  await page.goto("/deck");
  const resume = page.getByRole("dialog", { name: /^Continue with .+\?$/ });
  await expect(resume).toBeVisible({ timeout: 30_000 });
  await resume.getByRole("button", { name: "Yes" }).click();
  await expect(recs).toBeVisible({ timeout: 60_000 });

  await page.goto("/deck");
  await expect(resume).toBeVisible({ timeout: 30_000 });
  await resume.getByRole("button", { name: "No" }).click();
  await expect(page.getByRole("textbox", { name: "Decklist" })).toHaveValue("");
  // No forgets the deck, so the next visit asks nothing.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Decklist" })).toHaveValue("");
  await expect(resume).toBeHidden();
});

test("renames a deck from its name in the deck bar, and remembers the name for the next visit", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  await recs.getByRole("button", { name: /^Rename deck: / }).click();
  const field = recs.getByRole("textbox", { name: "Deck name" });
  await field.fill("Kitchen Table Brew");
  await field.press("Enter");
  await expect(recs.getByRole("button", { name: "Rename deck: Kitchen Table Brew" })).toBeVisible();

  // Escape puts the name back.
  await recs.getByRole("button", { name: "Rename deck: Kitchen Table Brew" }).click();
  await field.fill("Not this");
  await field.press("Escape");
  await expect(recs.getByRole("button", { name: "Rename deck: Kitchen Table Brew" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Continue with Kitchen Table Brew?" })).toBeVisible({ timeout: 30_000 });
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
  // The file stands in for the decklist box, so Analyze stays right under it; its text is a tap away.
  await expect(page.getByText("deck.csv")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Decklist" })).toBeHidden();
  await page.getByRole("button", { name: "Show text" }).click();
  // The two Sol Ring rows are one card the deck runs twice; the printings are gone.
  await expect(page.getByRole("textbox", { name: "Decklist" })).toHaveValue("2 Sol Ring\n1 Liesa, Forgotten Archangel");
});

test("a name search's next page continues the list rather than repeating it", async ({ request }) => {
  // Sorted, as the deckbuilder pages: without a sort the first page and later ones rank differently when the index is down.
  const page = async (offset: number) => {
    const res = await request.get(`/api/cards/search?q=angel&limit=5&offset=${offset}&sort=name_asc`);
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

test("builds a deck for a picked commander, then goes through it card by card", async ({ page }) => {
  await page.goto("/deck?start=build");
  // Chulane is the mock catalog's one commander, and a popular one in the real catalog.
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: 30_000 });
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: 90_000 });
  // Without a collection the build draws on every card, and says how to build from owned cards instead.
  await expect(built.getByText(/picked from every card in print/)).toBeVisible();
  await expect(built.getByRole("link", { name: "Import your collection" })).toBeVisible();
  await built.getByRole("button", { name: "Go through it card by card" }).click();
  await expect(page.getByRole("region", { name: "Recommendations" })).toBeVisible({ timeout: 90_000 });
});

test("fits a pasted list to the collection: owned cards stay, the rest comes from the collection", async ({ page }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "matching a collection needs the synced catalog (E2E_LOCAL_DATA)");
  await page.goto("/collection/import");
  await page.getByLabel("Collection export").fill("1 Liesa, Forgotten Archangel\n1 Arcane Signet\n1 Swords to Plowshares");
  await page.getByRole("button", { name: "Import collection", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: 30_000 });

  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Fit it to my collection" }).click();
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: 90_000 });
  await expect(built.getByText(/^Kept \d+ of the list's \d+ cards\./)).toBeVisible();
  // Sol Ring is in the sample list but not the collection, so it goes out.
  await expect(built.getByRole("list", { name: "Cards from the list you don't own" }).getByText("Sol Ring", { exact: true })).toBeVisible();
  await built.getByRole("button", { name: "Back to the list" }).click();
  await expect(page.getByLabel("Decklist")).toBeVisible();
});

test("Add may take a full deck past 100, and Cut then owes what was added", async ({ page }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "Deck stats' role targets need the synced corpus (E2E_LOCAL_DATA)");
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  const sitting = page.getByRole("region", { name: "Cards to add" });
  await sitting.getByRole("button", { name: /^Add / }).click({ timeout: 60_000 });
  await page.getByRole("navigation", { name: "Deck upgrade steps" }).getByRole("button", { name: "Cut" }).click();
  await expect(page.getByText(/^Cut 1 to get back to 100/)).toBeVisible();
});
