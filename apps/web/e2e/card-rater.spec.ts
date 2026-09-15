import { expect, test } from "@playwright/test";

test("rates replacements for a commander picked by name", async ({ page }) => {
  await page.goto("/rate");
  await page.getByRole("combobox", { name: "Commander" }).fill("chul");
  await page.getByRole("option", { name: /Chulane, Teller of Tales/ }).click();

  const rater = page.getByRole("region", { name: "Rate replacements" });
  await expect(rater.getByText(/^Card 1 of \d+$/)).toBeVisible({ timeout: 60_000 });
  const goodFit = rater.getByRole("button", { name: /^Good fit: / });
  await expect(goodFit).toBeVisible({ timeout: 60_000 });
  await goodFit.click();

  // Every swipe rates one replacement; the arrow keys work like the buttons.
  await expect(rater.getByRole("button", { name: /^(Not a fit: |Skip )/ }).first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("ArrowLeft");

  await rater.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: /^\d+ replacements? rated$/ })).toBeVisible();
  await page.getByRole("button", { name: "Pick another commander" }).click();
  await expect(page.getByRole("combobox", { name: "Commander" })).toBeVisible();
});
