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

  // A ManaBox CSV: a name with a comma in it, a Scryfall id, and a quantity above one.
  const csv = [
    "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Condition,Language",
    '"Page, Loose Leaf",SOS,Secrets of Strixhaven,250,normal,common,1,112642,8c6fecfd-8241-4cf0-b1eb-19472b99e0ed,0.24,near_mint,en',
    "Sol Ring,C21,Commander 2021,263,normal,uncommon,3,1,,0.99,near_mint,en",
    "Definitely Not A Real Card,ZZZ,Nowhere,1,normal,common,1,2,,0.00,near_mint,en",
  ].join("\n");

  await page.locator("input[type=file]").setInputFiles({ name: "manabox_export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  // The file is read in the browser, so its contents land in the box for review before anything is sent.
  await expect(page.getByText("Read manabox_export.csv")).toBeVisible();

  await page.getByRole("button", { name: "Import collection" }).click();
  const summary = page.getByRole("region", { name: "Saved collection" });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  // Two of the three rows are real cards, and Sol Ring's quantity of 3 survives the CSV.
  await expect(summary.getByText("4", { exact: true })).toBeVisible();
  await expect(summary.getByText("1 line didn't match a card")).toBeVisible();
});
