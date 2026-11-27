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

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the Latest tab and a swipe move between the two lists", async ({ page }) => {
    await page.goto("/");
    const region = page.getByRole("region", { name: "Commanders & Decks" });
    const popularTab = region.getByRole("tab", { name: "Popular", exact: true });
    const latestTab = region.getByRole("tab", { name: "Latest", exact: true });
    const popularPane = region.getByRole("tabpanel", { name: "Popular", exact: true });
    const latestPane = region.getByRole("tabpanel", { name: "Latest", exact: true });
    await expect(popularTab).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
    await expect(latestPane).not.toBeInViewport();

    await region.scrollIntoViewIfNeeded();
    await latestTab.click();

    await expect(latestTab).toHaveAttribute("aria-selected", "true");
    await expect(latestPane).toBeInViewport();
    await expect(popularPane).not.toBeInViewport();

    // A swipe back, once the tap's scroll has landed: the strip scrolled by hand moves the tab with it.
    const strip = popularPane.locator("..");
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft === el.scrollWidth - el.clientWidth)).toBe(true);
    await strip.evaluate((el) => el.scrollTo({ left: 0 }));

    await expect(popularTab).toHaveAttribute("aria-selected", "true");
    await expect(popularPane).toBeInViewport();
  });

  test("the page never scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Commanders & Decks" }).getByRole("tab", { name: "Popular", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
});
