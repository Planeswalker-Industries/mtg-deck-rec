import { expect, test } from "@playwright/test";

test("analyzes the sample deck and opens replacements for a card", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await expect(recs.getByRole("tab", { name: "Cards to cut" })).toBeVisible();

  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  const notNow = page.getByRole("dialog").getByRole("button", { name: "Not now" });
  await notNow.click({ timeout: 3_000 }).catch(() => undefined);

  await recs.getByRole("tab", { name: "Cards to add" }).click();
  await recs.getByRole("tab", { name: "Your deck" }).click();
  const deckCards = recs.getByRole("list", { name: "Your deck" }).getByRole("button");
  await expect(deckCards.first()).toBeVisible();
  await deckCards.first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: /^Replace / })).toBeVisible();
  await expect(sheet.getByText("Cards that do the same job, best fit first.")).toBeVisible();
});
