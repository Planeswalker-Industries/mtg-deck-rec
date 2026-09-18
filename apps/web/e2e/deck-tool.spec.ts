import { expect, test } from "@playwright/test";

test("analyzes the sample deck and opens replacements for a card", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // Swiping is the default on a first visit; the list keeps the Cut/Add/Replace selector.
  await expect(recs.getByRole("button", { name: "Swipe" })).toHaveAttribute("aria-pressed", "true");

  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  const notNow = page.getByRole("dialog").getByRole("button", { name: "Not now" });
  await notNow.click({ timeout: 3_000 }).catch(() => undefined);

  await recs.getByRole("button", { name: "List" }).click();
  await expect(recs.getByRole("button", { name: /^Cut Weak links/ })).toBeVisible();
  // Drilling into a job collapses the selector to a Back control; the deck is what the workspace shows by default.
  await recs.getByRole("button", { name: /^Add Missing pieces/ }).click();
  await recs.getByRole("button", { name: "Back" }).click();
  // The deck is grouped now: several card lists inside one named region, under the grouping pills.
  // Scope to a list so the pills themselves are not mistaken for cards.
  const deckCards = recs.getByRole("region", { name: "Your deck" }).getByRole("list").first().getByRole("button");
  await expect(deckCards.first()).toBeVisible();
  await deckCards.first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: /^Replace / })).toBeVisible();
  await expect(sheet.getByText("Cards that do the same job, best fit first.")).toBeVisible();
});

test("remembers the list view for the next visit", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);
  await recs.getByRole("button", { name: "List" }).click();

  // The deck and the view both come back after a reload.
  await page.reload();
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await expect(recs.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await expect(recs.getByRole("button", { name: /^Cut Weak links/ })).toBeVisible();
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
