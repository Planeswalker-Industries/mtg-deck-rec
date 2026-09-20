import { expect, test } from "@playwright/test";

test("three step headings are present", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Import your collection" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your decklist" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cut/Add/Replace" })).toBeVisible();
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
  const region = page.getByRole("region", { name: "Popular Commanders" });
  // The Ur-Dragon is five-color, so every pip including colorless renders.
  await expect(region.getByAltText("Colorless")).toBeVisible({ timeout: 10_000 });
  await expect(region.getByAltText("White")).toBeVisible();
  await expect(region.getByAltText("Red")).toBeVisible();
});

test("clicking a dot swaps the commander name", async ({ page }) => {
  await page.goto("/");
  const region = page.getByRole("region", { name: "Popular Commanders" });
  const dots = region.locator('[role="group"][aria-label="Featured commanders"] button');
  await expect(dots.first()).toBeVisible({ timeout: 10_000 });

  // Get the initial commander name
  const name = region.getByRole("heading", { level: 3 });
  const firstName = await name.textContent();

  // Click the second dot (index 1)
  await dots.nth(1).click();

  // The commander name should have changed
  await expect(name).not.toHaveText(firstName!);
});

test("Build this Deck navigates to /deck?commander=", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "Build this Deck" });
  await expect(link).toBeVisible({ timeout: 10_000 });

  // The button wears the page shade and the lamp itself, not the outline variant's dark-mode input fill.
  // Read the tokens rather than hardcoding, so a palette tweak can't fail this.
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const resolve = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value.trim();
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      background: resolve(root.getPropertyValue("--background")),
      primary: resolve(root.getPropertyValue("--primary")),
    };
  });
  await expect(link).toHaveCSS("background-color", tokens.background);
  await expect(link).toHaveCSS("border-top-color", tokens.primary);

  await link.click();
  await expect(page).toHaveURL(/\/deck\?commander=/);
});
