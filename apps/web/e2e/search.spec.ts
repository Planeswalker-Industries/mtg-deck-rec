import { expect, test } from "@playwright/test";

// At phone width the header shows a search button that opens a full-screen layer.
test("searches for a card from the header and opens its page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search cards" }).click();

  const layer = page.getByRole("dialog", { name: "Search cards" });
  await expect(layer).toBeVisible();

  const field = layer.getByRole("combobox");
  await field.fill("sol");

  const results = layer.getByRole("listbox", { name: "Search results" });
  await expect(results).toBeVisible({ timeout: 30_000 });
  const options = results.getByRole("option");
  await expect(options.first()).toBeVisible();

  await options.first().click();
  // The card page itself needs a synced catalog, so only assert where we were sent.
  await page.waitForURL(/\/card\//, { timeout: 30_000 });
});

test("closes the search layer with Escape without navigating", async ({ page }) => {
  await page.goto("/");
  const before = page.url();
  await page.getByRole("button", { name: "Search cards" }).click();

  const layer = page.getByRole("dialog", { name: "Search cards" });
  await expect(layer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(layer).toBeHidden();
  expect(page.url()).toBe(before);
});

test("says so when nothing matches", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search cards" }).click();

  const layer = page.getByRole("dialog", { name: "Search cards" });
  await layer.getByRole("combobox").fill("zzzzzznotacard");
  await expect(layer.getByText("No cards match that name.")).toBeVisible({ timeout: 30_000 });
});
