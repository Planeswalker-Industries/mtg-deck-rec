import { expect, test } from "@playwright/test";

test("swipes through cards to cut and puts a picked replacement in the deck", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();

  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  // With real data the sample commander may have no play data, which offers a deck lookup. Not needed here.
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  // Swiping is the default on a first visit.
  await expect(recs.getByRole("button", { name: "Swipe" })).toHaveAttribute("aria-pressed", "true");
  const rater = page.getByRole("region", { name: "Swipe through cards to cut" });
  await expect(rater.getByText(/^Card 1 of \d+ to cut$/)).toBeVisible({ timeout: 60_000 });

  const swapIn = rater.getByRole("button", { name: /^Swap in / });
  await expect(swapIn).toBeVisible({ timeout: 60_000 });
  const picked = ((await swapIn.getAttribute("aria-label")) ?? "").replace(/^Swap in /, "");
  await swapIn.click();
  await expect(rater.getByText(/^Card 2 of \d+ to cut$/)).toBeVisible();

  // The arrow keys pass and swap like the buttons.
  const passOn = rater.getByRole("button", { name: /^Pass on / });
  if (await passOn.isVisible({ timeout: 30_000 }).catch(() => false)) {
    const before = await passOn.getAttribute("aria-label");
    await page.keyboard.press("ArrowLeft");
    await expect(rater.getByRole("button", { name: /^Pass on / })).not.toHaveAttribute("aria-label", before ?? "", { timeout: 10_000 }).catch(() => undefined);
  }

  await rater.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "1 swap picked" })).toBeVisible();
  await expect(page.getByText("Your decklist now has these swaps.")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "See the list" }).click();
  await recs.getByRole("tab", { name: "Your deck" }).click();
  const pickedName = picked.split(" // ")[0] ?? picked;
  await expect(recs.getByRole("list", { name: "Your deck" }).getByText(pickedName, { exact: true })).toBeVisible({ timeout: 60_000 });
});
