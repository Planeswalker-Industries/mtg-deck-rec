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
  await recs.getByRole("tab", { name: "Cards to add" }).click();
  await expect(recs.getByText(/Nothing in your collection fits this deck's colors/)).toBeVisible({ timeout: 60_000 });

  await page.goto("/collection");
  await page.getByRole("button", { name: "Clear collection" }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeHidden();
});
