import { expect, test } from "@playwright/test";

test("imports a collection and limits suggestions to owned cards", async ({ page }) => {
  await page.goto("/collection/import");
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
  await recs.getByRole("button", { name: "Edit deck" }).click();
  await recs.getByRole("button", { name: /^Add Missing pieces/ }).click();
  await expect(recs.getByText(/Nothing in your collection fits this deck's colors/)).toBeVisible({ timeout: 60_000 });

  await page.goto("/collection/import");
  await page.getByRole("button", { name: "Clear collection" }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeHidden();
});

// Only links the app can't read are exercised here: an Archidekt link would make a real request to Archidekt, which
// tests must never do. The Archidekt path is covered by the parser tests in @mtg/core and checked by hand.
test("a link the app can't read says how to export instead", async ({ page }) => {
  await page.goto("/collection/import");
  await page.getByLabel("Collection export").fill("https://manabox.app/binders/example");
  await page.getByRole("button", { name: "Import from link" }).click();
  await expect(page.getByText(/ManaBox links can't be imported yet\..*export a CSV/)).toBeVisible({ timeout: 30_000 });

  // Changing the text clears the old problem, and a plain export gets the usual button back.
  await page.getByLabel("Collection export").fill("1 Sol Ring");
  await expect(page.getByText(/ManaBox links can't be imported/)).toBeHidden();
  await expect(page.getByRole("button", { name: /Import collection|Replace collection/ })).toBeVisible();
});

test("imports a CSV export from a file, keeping its Scryfall ids", async ({ page }) => {
  await page.goto("/collection/import");

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

test("browses a collection by name, color and type", async ({ page }) => {
  await page.goto("/collection");
  await expect(page.getByRole("heading", { name: "No collection yet" })).toBeVisible({ timeout: 30_000 });

  await page.goto("/collection/import");
  await page.getByLabel("Collection export").fill("2 Sol Ring\n1 Chulane, Teller of Tales");
  await page.getByRole("button", { name: "Import collection" }).click();
  const summary = page.getByRole("region", { name: "Saved collection" });
  await summary.getByRole("link", { name: "Browse your collection" }).click({ timeout: 30_000 });

  const legends = page.getByRole("list", { name: "Legendary creatures" });
  const artifacts = page.getByRole("list", { name: "Artifacts" });
  await expect(legends.getByText("Chulane, Teller of Tales")).toBeVisible({ timeout: 30_000 });
  await expect(artifacts.getByText("Sol Ring")).toBeVisible();
  await expect(artifacts.getByText("×2")).toBeVisible();

  const search = page.getByRole("searchbox", { name: /Search your collection/ });
  await search.fill("chulane");
  await expect(artifacts).toBeHidden();
  await expect(legends.getByText("Chulane, Teller of Tales")).toBeVisible();
  await search.fill("");

  // Colorless keeps Sol Ring; Chulane is green-white-blue.
  await page.getByRole("button", { name: "Colorless" }).click();
  await expect(artifacts.getByText("Sol Ring")).toBeVisible();
  await expect(legends).toBeHidden();

  // Multicolor with green: Chulane has green among several colors; Sol Ring has none.
  await page.getByRole("button", { name: "Colorless" }).click();
  await page.getByRole("button", { name: "Green" }).click();
  await page.getByRole("button", { name: /^Multicolor/ }).click();
  await expect(legends.getByText("Chulane, Teller of Tales")).toBeVisible();
  await expect(artifacts).toBeHidden();

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await page.getByRole("button", { name: /^Artifacts/ }).click();
  await expect(artifacts).toBeHidden();
  await expect(legends).toBeVisible();

  await page.goto("/collection/import");
  await page.getByRole("button", { name: "Clear collection" }).click();
});
