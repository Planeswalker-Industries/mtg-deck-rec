import { test as withoutOfferSkip } from "@playwright/test";
import { clearBuildBudget, expect, openSwap, test, toDeckbuilder, type Page } from "./fixtures";

/** Tailwind's `lg` breakpoint, where the deckbuilder shows search beside the deck instead of its own tab. */
const LG_BREAKPOINT_PX = 1024;

/** Analyzes the sample deck and opens the deckbuilder through Save. Returns the recommendations region. */
async function openDeckbuilder(page: Page) {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  return toDeckbuilder(page);
}

/** Opens the deckbuilder's card search: its own tab on a phone, beside the deck on a wide screen. */
async function openCardSearch(page: Page) {
  const recs = await openDeckbuilder(page);
  const width = page.viewportSize()?.width ?? 0;
  if (width < LG_BREAKPOINT_PX) await recs.getByRole("button", { name: "Edit", exact: true }).click();
  return { recs, search: recs.getByRole("region", { name: "Add cards" }) };
}

test("analyzes the sample deck, and the deckbuilder swaps a card for a replacement", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // The upgrade journey is what opens, with no control to switch to the deckbuilder; Save opens it.
  await expect(recs.getByRole("navigation", { name: "Deck upgrade steps" })).toBeVisible({ timeout: 60_000 });
  await expect(recs.getByRole("button", { name: "Deckbuilder" })).toHaveCount(0);

  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  const notNow = page.getByRole("dialog").getByRole("button", { name: "Not now" });
  await notNow.click({ timeout: 3_000 }).catch(() => undefined);

  await toDeckbuilder(page);
  const deckList = recs.getByRole("region", { name: "Deck list" });
  const replace = deckList.getByRole("button", { name: /^Replace / }).first();
  await expect(replace).toBeVisible({ timeout: 60_000 });
  const target = ((await replace.getAttribute("aria-label")) ?? "").replace(/^Replace /, "");
  await replace.click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: `Replace ${target}` })).toBeVisible();
  await expect(sheet.getByText("Cards that do the same job, best fit first.")).toBeVisible();
  const swapIn = sheet.getByRole("button", { name: /^Swap in / });
  const nothing = sheet.getByText(/No legal replacements|No valid swaps right now/);
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
  // Swipe or list is a choice on Add, Cut and Swap. The mocks' sample is short and opens on Add; the real catalog's is
  // at 100 and opens on Fix, which has one view, so the choice is made (and looked for again) on Swap.
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  const opensOnAdd = (await steps.getByRole("button").first().innerText()).trim() === "Add";
  if (!opensOnAdd) await openSwap(page);
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
  // On a phone the view toggle now offers the swipe view back. The round picks up on the step it was left on.
  await expect(recs.getByRole("button", { name: "Swipe one card at a time" })).toBeVisible({ timeout: 60_000 });
  if (opensOnAdd) await expect(recs.getByRole("list", { name: "Cards to add" })).toBeVisible({ timeout: 60_000 });

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
  const build = page.getByRole("button", { name: "Build deck" });
  // Nothing to build until a commander is picked; the pick alone builds nothing.
  await expect(build).toBeDisabled();
  await page.getByRole("combobox", { name: "Commander", exact: true }).fill("Chulane");
  await page.getByRole("option", { name: /Chulane/ }).first().click({ timeout: 30_000 });
  await clearBuildBudget(page);
  await build.click();
  const built = page.getByRole("region", { name: "Your built deck" });
  await expect(built).toBeVisible({ timeout: 90_000 });
  // Without a collection the build draws on every card, and says how to build from owned cards instead.
  await expect(built.getByText(/picked from every card in print/)).toBeVisible();
  await expect(built.getByRole("link", { name: "Import your collection" })).toBeVisible();
  await built.getByRole("button", { name: "Tune it" }).click();
  await expect(page.getByRole("region", { name: "Recommendations" })).toBeVisible({ timeout: 90_000 });
});

test("commander page builds its commander", async ({ page }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "commander pages need the corpus (E2E_LOCAL_DATA)");
  await page.goto("/commander/liesa-forgotten-archangel");
  await page.getByRole("link", { name: "Build this Commander" }).click();
  await expect(page).toHaveURL(/[?&]start=build&commander=liesa-forgotten-archangel/);
  // The plate shows the linked commander in place of the search box, ready to build.
  await expect(page.getByText("Liesa, Forgotten Archangel", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Commander", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Build deck" })).toBeEnabled();
});

test("an unknown commander slug leaves the picker empty", async ({ page }) => {
  await page.goto("/deck?start=build&commander=not-a-commander");
  await expect(page.getByRole("combobox", { name: "Commander", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Build deck" })).toBeDisabled();
});

test("fits a pasted list to the collection: owned cards stay, the rest comes from the collection", async ({ page }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "matching a collection needs the synced catalog (E2E_LOCAL_DATA)");
  await page.goto("/collection/import");
  await page.getByLabel("Collection import").fill("1 Liesa, Forgotten Archangel\n1 Arcane Signet\n1 Swords to Plowshares");
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

test("a full deck has nothing to add or cut: the round opens on Fix", async ({ page }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "The 100-card sample deck is the real catalog's (E2E_LOCAL_DATA)");
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  const steps = page.getByRole("navigation", { name: "Deck upgrade steps" });
  await expect(steps.getByRole("button")).toHaveText(["Fix", "Swap", "Finish"], { timeout: 60_000 });
});

// The plain Playwright test: the fixture's handler would answer the offer before this check could see it.
withoutOfferSkip("offers a collection import on every visit until there is one", async ({ page }) => {
  const offer = page.getByRole("dialog", { name: "Hold up — got cards already?" });
  await page.goto("/deck?start=build");
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Commander", exact: true })).toBeVisible();

  // Going to the import and back without importing anything asks again.
  await page.reload();
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.getByRole("link", { name: "Add collection" }).click();
  await expect(page).toHaveURL(/\/collection\/import\?next=/);
  await page.goBack();
  await expect(offer).toBeVisible({ timeout: 30_000 });
});

test("the start form's budget validates", async ({ page }) => {
  await page.goto("/deck");
  await expect(page.getByRole("combobox", { name: "Bracket" })).toHaveText("3 Upgraded");
  const perCard = page.getByRole("textbox", { name: "Max per card" });
  // By text: Next's route announcer is a role="alert" too. The collection offer can open over the form as the first
  // value goes in and swallow it, so that one is retried until it lands.
  await expect(async () => {
    await perCard.fill("-1");
    await expect(page.getByText("A budget can't be negative.")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await perCard.fill("abc");
  await expect(page.getByText("Enter a price per card.")).toBeVisible();
  await perCard.fill("5");
  await expect(page.getByText("Enter a price per card.")).toBeHidden();
  // $0 to spend without a collection can only use cards the player owns: the form says so and offers the import.
  await page.getByRole("textbox", { name: "Max to spend" }).fill("0");
  await expect(page.getByText("With $0 we can only use cards you own.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Import collection" })).toBeVisible();
});

/** Pastes the sample (estimated Bracket 3), asks for Bracket 2 and analyzes. */
async function analyzeAtBracketTwo(page: Page) {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("combobox", { name: "Bracket" }).click();
  await page.getByRole("option", { name: "2 Core" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const warning = page.getByRole("dialog", { name: "Deck Bracket 3" });
  await expect(warning).toBeVisible({ timeout: 60_000 });
  await expect(warning.getByText("Your deck is above your selected bracket. We will reduce its power level to your selected Bracket (Bracket 2).")).toBeVisible();
  return warning;
}

test("a deck above the chosen bracket warns; Cancel returns to Bracket", async ({ page }) => {
  const warning = await analyzeAtBracketTwo(page);
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Bracket" })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Deck upgrade steps" })).toBeHidden();
});

test("Proceed continues to the round", async ({ page }) => {
  const warning = await analyzeAtBracketTwo(page);
  await warning.getByRole("button", { name: "Proceed" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  await expect(page.getByRole("navigation", { name: "Deck upgrade steps" })).toBeVisible({ timeout: 60_000 });
});
