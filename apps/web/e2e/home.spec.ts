import { expect, test } from "@playwright/test";

test("three step headings are present", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Import your collection" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your decklist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cut/Add/Swap" })).toBeVisible();
});

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

test("pointing at a ring slice names it in the centre", async ({ page }) => {
  await page.goto("/");
  const ring = page.getByRole("region", { name: "Popular Decks" }).locator("svg[role='img'][aria-label]");
  await expect(ring).toBeVisible({ timeout: 10_000 });
  await expect(ring).toContainText("cards");

  // Lands are the first slice, drawn clockwise from twelve o'clock, so a point just right of the top lands on them.
  // Retried: a pointer that arrives before hydration has no handler to reach, so move off and back on.
  await ring.scrollIntoViewIfNeeded();
  await expect(async () => {
    const box = (await ring.boundingBox())!;
    await page.mouse.move(0, 0);
    await ring.hover({ position: { x: box.width * 0.55, y: box.height * 0.08 } });
    await expect(ring).toContainText("lands", { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
});
