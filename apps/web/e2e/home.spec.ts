import { expect, test } from "@playwright/test";

test("ring aria-label names every category", async ({ page }) => {
  await page.goto("/");
  const ring = page.locator("svg[role='img'][aria-label]");
  await expect(ring).toBeVisible({ timeout: 10_000 });
  const label = await ring.getAttribute("aria-label");
  expect(label).toContain("Creatures");
  expect(label).toContain("Instants");
  expect(label).toContain("Sorceries");
  expect(label).toContain("Artifacts");
  expect(label).toContain("Enchantments");
  expect(label).toContain("Planeswalkers");
  expect(label).toContain("Battles");
  expect(label).toContain("Lands");
});

test("deck overview shows its mana-symbol split", async ({ page }) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "Popular Decks" });
  // The Ur-Dragon is five-color, so every pip including colorless renders.
  await expect(region.getByAltText("Colorless")).toBeVisible({ timeout: 10_000 });
  await expect(region.getByAltText("White")).toBeVisible();
  await expect(region.getByAltText("Red")).toBeVisible();
});

test("clicking a tile selects that commander", async ({ page }) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "Popular Decks" });
  const tiles = region.getByRole("group", { name: "Featured commanders" }).getByRole("button");
  await expect(tiles.first()).toBeVisible({ timeout: 10_000 });
  await expect(tiles.first()).toHaveAttribute("aria-current", "true");

  await tiles.nth(1).click();

  await expect(tiles.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(tiles.first()).toHaveAttribute("aria-current", "false");
});

test("the Commander starting point opens the commander picker", async ({ page }) => {
  await page.goto("/");
  const commander = page.getByRole("link", { name: /pulled a cool new Commander!.*Add your commander/ });
  await expect(commander).toHaveAttribute("href", "/deck?start=build");
});
