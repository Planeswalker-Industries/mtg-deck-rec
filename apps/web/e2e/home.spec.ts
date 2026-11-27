import { expect, test } from "./fixtures";

test("Commanders & Decks shows three Popular Commanders and the Highlight's seal", async ({ page }) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "Commanders & Decks" });
  const plates = region.getByRole("list", { name: "Popular Commanders" }).getByRole("button");
  await expect(plates).toHaveCount(3, { timeout: 10_000 });
  await expect(plates.first()).toHaveAttribute("aria-current", "true");
  await expect(region.getByRole("link", { name: /^Build with this Commander/ })).toHaveAttribute("href", /\/deck\?.*commander=/);
});

test("tapping a Popular plate moves the Highlight and its seal", async ({ page }) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "Commanders & Decks" });
  const plates = region.getByRole("list", { name: "Popular Commanders" }).getByRole("button");
  const seal = region.getByRole("link", { name: /^Build with this Commander/ });
  await expect(plates.first()).toHaveAttribute("aria-current", "true", { timeout: 10_000 });
  const firstHref = await seal.getAttribute("href");

  await plates.nth(1).click();

  await expect(plates.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(plates.first()).toHaveAttribute("aria-current", "false");
  await expect(seal).not.toHaveAttribute("href", firstHref ?? "");
});

test("the Commander starting point opens the commander picker", async ({ page }) => {
  await page.goto("/");
  // The hero and the closing sheet both carry the pair; the link's name includes its sub line.
  const commander = page.getByRole("link", { name: /^Choose a Commander/ }).first();
  await expect(commander).toHaveAttribute("href", "/deck?start=build");
});
