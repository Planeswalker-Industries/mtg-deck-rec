import { expect, test, type Page } from "@playwright/test";
import { mailpit, signIn } from "./mailpit";

/** Whether the tool's open deck has reached the account: "Saved", "Saving…" or the reason it didn't. */
const savedDeckStatus = (page: Page) => page.getByRole("region", { name: "Saved deck" }).getByRole("status");

// Saving needs an account, so these run only where the local mail catcher is up.
test.skip(!mailpit, "set E2E_MAILPIT_URL to run the saved deck checks");

test("signed out, the deck list asks you to sign in", async ({ page }) => {
  await page.goto("/decks");
  await page.waitForURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/decks");
});

test("saves a deck, then renames, duplicates and deletes it from the list", async ({ page, request }) => {
  const email = `decks-${Date.now()}@test.invalid`;
  await signIn(page, request, email, "/decks");

  // A fresh account has nothing saved.
  await expect(page.getByRole("heading", { name: "No decks saved yet." })).toBeVisible();

  // Build a deck in the tool and save it.
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);

  const save = page.getByRole("button", { name: "Save deck" });
  await expect(save).toBeVisible({ timeout: 60_000 });
  await save.click();
  const name = page.getByRole("textbox", { name: /deck name/i });
  await expect(name).toBeVisible();
  // The name is prefilled from the commander, so saving is one click.
  await expect(name).not.toHaveValue("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Fail here, not on the list, if the save itself was refused. Saving hands the deck to the tool, which says so.
  await expect(savedDeckStatus(page)).toHaveText("Saved", { timeout: 30_000 });

  await page.goto("/decks");
  const list = page.getByRole("listitem");
  await expect(list).toHaveCount(1);

  // Rename.
  await page.getByRole("button", { name: /^Rename / }).click();
  const rename = page.getByRole("textbox", { name: /^New name for / });
  await rename.fill("Renamed Deck");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Renamed Deck", exact: true })).toBeVisible();

  // Duplicate.
  await page.getByRole("button", { name: /^Duplicate / }).first().click();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Renamed Deck (copy)", exact: true })).toBeVisible();

  // Delete, which confirms first.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete Renamed Deck (copy)" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("a saved deck has its own page, and hiding it keeps strangers out", async ({ page, request, browser }) => {
  const email = `deckpage-${Date.now()}@test.invalid`;
  await signIn(page, request, email, "/decks");

  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);
  await page.getByRole("button", { name: "Save deck" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(savedDeckStatus(page)).toHaveText("Saved", { timeout: 30_000 });

  await page.goto("/decks");
  await page.getByRole("listitem").getByRole("link").first().click();
  // /decks/<commander-slug>/<code>: the code identifies the deck, the slug is decoration.
  await page.waitForURL(/\/decks\/[^/]+\/[A-Za-z0-9]{8,32}$/);
  const url = page.url();

  // The deck's cards are on the page, grouped by type.
  await expect(page.getByRole("heading", { name: "Lands" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Creatures" })).toBeVisible();

  // A new deck is public, so a signed-out visitor can read it.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  const asPublic = await strangerPage.goto(url);
  expect(asPublic?.status()).toBe(200);
  await expect(strangerPage.getByRole("link", { name: "Report it" })).toBeVisible();
  // Anyone who can see the page can download it, with the commander on its own board.
  const exportUrl = `${url}/export?format=csv`;
  const publicCsv = await stranger.request.get(exportUrl);
  expect(publicCsv.status()).toBe(200);
  expect(publicCsv.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.csv"$/);
  const csv = await publicCsv.text();
  expect(csv.split("\r\n")[0]).toBe("Quantity,Name,Set code,Collector number,Board");
  expect(csv).toMatch(/,commander\r\n/);
  expect(csv).toContain("Sol Ring");

  // Hiding it takes the page away from everyone else.
  await page.getByRole("switch").click();
  await expect(page.getByText("Only you can see this deck")).toBeVisible({ timeout: 30_000 });
  const asPrivate = await strangerPage.goto(url);
  expect(asPrivate?.status()).toBe(404);
  // And the content must not leak either way.
  await expect(strangerPage.getByRole("heading", { name: "Lands" })).toBeHidden();
  const leaked = await strangerPage.evaluate(() => document.body.innerText);
  expect(leaked).not.toContain("Sol Ring");
  // The download goes with the page.
  expect((await stranger.request.get(exportUrl)).status()).toBe(404);
  await stranger.close();
  // Its owner can still download it.
  const ownerText = await page.request.get(`${url}/export?format=txt`);
  expect(ownerText.status()).toBe(200);
  expect(await ownerText.text()).toMatch(/^Commander\n1 /);

  // The owner still sees it.
  await page.reload();
  await expect(page.getByText("Only you can see this deck")).toBeVisible();
});

test("reopens a saved deck in the tool, and edits go back to it", async ({ page, request }) => {
  const email = `reopen-${Date.now()}@test.invalid`;
  await signIn(page, request, email, "/decks");

  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  const decklist = await page.getByRole("textbox", { name: "Decklist" }).inputValue();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);
  await page.getByRole("button", { name: "Save deck" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(savedDeckStatus(page)).toHaveText("Saved", { timeout: 30_000 });

  // Come back to it from the list, by its own link rather than the deck page.
  await page.goto("/decks");
  await page.getByRole("link", { name: /^Open .* in the deck tool$/ }).click();
  await page.waitForURL(/\/deck\?deck=[A-Za-z0-9]{8,32}$/);

  const bar = page.getByRole("region", { name: "Saved deck" });
  await expect(bar).toBeVisible({ timeout: 60_000 });
  await expect(savedDeckStatus(page)).toHaveText("Saved", { timeout: 60_000 });
  // The deck came back analysed, not as an empty box.
  await expect(page.getByRole("region", { name: "Recommendations" })).toBeVisible({ timeout: 60_000 });

  // An edit is written back to the same deck, without another Save.
  await page.getByRole("button", { name: "Edit decklist" }).click();
  const box = page.getByRole("textbox", { name: "Decklist" });
  await box.fill(decklist.split("\n").filter((line) => line.trim() !== "1 Sol Ring").join("\n"));
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);
  await expect(savedDeckStatus(page)).toHaveText("Saved", { timeout: 60_000 });

  // And the stored deck really did change: the deck page is a card short, and no longer has the cut card.
  await bar.getByRole("link", { name: "Deck page" }).click();
  await page.waitForURL(/\/decks\/[^/]+\/[A-Za-z0-9]{8,32}$/);
  // Scoped to the deck page itself: a client navigation keeps the tool it came from in the DOM for a moment.
  const deckPage = page.getByRole("article");
  await expect(deckPage.getByText("99 cards", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(deckPage.getByText("Sol Ring")).toHaveCount(0);
});

test("saving a journey's result keeps the original, which the deck page compares and restores", async ({ page, request }) => {
  const email = `original-${Date.now()}@test.invalid`;
  await signIn(page, request, email, "/decks");

  // A short Chulane deck with one off-colour card, which the Cut phase deals as a mandatory cut.
  await page.goto("/deck");
  await page
    .getByRole("textbox", { name: "Decklist" })
    .fill(["Commander", "1 Chulane, Teller of Tales", "", "Deck", "1 Sol Ring", "1 Arcane Signet", "1 Lightning Bolt", "1 Command Tower"].join("\n"));
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);

  const recs = page.getByRole("region", { name: "Recommendations" });
  await recs.getByRole("button", { name: "Cut Lightning Bolt" }).click({ timeout: 60_000 });
  await recs.getByRole("button", { name: /^Next: add \d+ cards?$/ }).click();
  await recs.getByRole("button", { name: "Done adding for now" }).click({ timeout: 60_000 });
  const rater = recs.getByRole("region", { name: "Swipe through cards to replace" });
  const toReview = recs.getByRole("button", { name: "Next: review the deck" });
  await expect(rater.or(toReview)).toBeVisible({ timeout: 60_000 });
  if (await rater.isVisible()) await rater.getByRole("button", { name: "Finish" }).click();
  else await toReview.click();

  // Save from Review opens the name form in the editor, prefilled.
  await recs.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click({ timeout: 60_000 });
  await expect(savedDeckStatus(page)).toHaveText("Saved", { timeout: 30_000 });

  // The deck page shows what changed since the original.
  await page.getByRole("region", { name: "Saved deck" }).getByRole("link", { name: "Deck page" }).click();
  await page.waitForURL(/\/decks\/[^/]+\/[A-Za-z0-9]{8,32}$/);
  const changes = page.getByRole("region", { name: "Changes from the original" });
  await expect(changes).toBeVisible({ timeout: 30_000 });
  await expect(changes.getByRole("list", { name: "Cards taken out since the original" }).getByText("Lightning Bolt")).toBeVisible();

  // Restoring puts the original back, after asking.
  await changes.getByRole("button", { name: "Restore original" }).click();
  await changes.getByRole("button", { name: "Restore original" }).click();
  await expect(changes.getByText(/matches the list it started from/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("article").getByText("Lightning Bolt").first()).toBeVisible();
});
