import { expect, test } from "@playwright/test";

test("imports a collection and limits suggestions to owned cards", async ({ page }) => {
  await page.goto("/collection");
  await page.getByLabel("Collection export").fill("1 Sol Ring\n1 Definitely Not A Real Card");
  await page.getByRole("button", { name: "Import collection" }).click();

  const summary = page.getByRole("region", { name: "Saved collection" });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary.getByText("Different cards")).toBeVisible();
  await expect(summary.getByText("1 line didn't match a card")).toBeVisible();

  await summary.getByRole("link", { name: "Use it in the deck tool" }).click();
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // With real data the sample commander may prompt for a deck lookup; not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  const ownedOnly = page.getByRole("switch", { name: "Only cards I own" });
  await expect(ownedOnly).toBeVisible();
  await ownedOnly.click();
  await expect(ownedOnly).toBeChecked();

  // The only owned card (Sol Ring) is already in the sample deck, so there's nothing to add.
  await recs.getByRole("button", { name: "List" }).click();
  await recs.getByRole("button", { name: /^Add Missing pieces/ }).click();
  await expect(recs.getByText(/Nothing in your collection fits this deck's colors/)).toBeVisible({ timeout: 60_000 });

  await page.goto("/collection");
  await page.getByRole("button", { name: "Clear collection" }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeHidden();
});

test("imports a CSV export from a file, keeping its Scryfall ids", async ({ page }) => {
  await page.goto("/collection");

  /*
   * A ManaBox-shaped CSV. Both real cards are in the mock pool as well as the real catalog, so the counts below hold
   * whether CI runs this against mocks or a laptop runs it against the catalog. Chulane earns its place by having a
   * comma in its name: unquoted, the CSV reader would split it into two broken fields.
   */
  const csv = [
    "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Condition,Language",
    '"Chulane, Teller of Tales",ELD,Throne of Eldraine,326,normal,mythic,1,1,8c6fecfd-8241-4cf0-b1eb-19472b99e0ed,4.20,near_mint,en',
    "Sol Ring,C21,Commander 2021,263,normal,uncommon,3,2,,0.99,near_mint,en",
    "Definitely Not A Real Card,ZZZ,Nowhere,1,normal,common,1,3,,0.00,near_mint,en",
  ].join("\n");

  await page.locator("input[type=file]").setInputFiles({ name: "manabox_export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  // The file is read in the browser, so its contents land in the box for review before anything is sent.
  await expect(page.getByText("Read manabox_export.csv")).toBeVisible();

  await page.getByRole("button", { name: "Import collection" }).click();
  const summary = page.getByRole("region", { name: "Saved collection" });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  // Two of the three rows are cards, and Sol Ring's quantity of 3 survived the CSV: 1 + 3 copies.
  await expect(summary.getByText("2", { exact: true })).toBeVisible();
  await expect(summary.getByText("4", { exact: true })).toBeVisible();
  await expect(summary.getByText("1 line didn't match a card")).toBeVisible();
});
