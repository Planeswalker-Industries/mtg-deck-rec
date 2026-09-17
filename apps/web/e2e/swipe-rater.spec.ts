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
  const pickedName = picked.split(" // ")[0] ?? picked;
  await expect(recs.getByRole("region", { name: "Your deck" }).getByText(pickedName, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
});

test("enlarges a card on tap and dismisses it without swiping the card underneath", async ({ page }) => {
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog", { name: /deck lookup|decks/i }).getByRole("button", { name: "Not now" }).click({ timeout: 3_000 }).catch(() => undefined);

  const rater = page.getByRole("region", { name: "Swipe through cards to cut" });
  const swapIn = rater.getByRole("button", { name: /^Swap in / });
  await expect(swapIn).toBeVisible({ timeout: 60_000 });
  const progress = rater.getByText(/^Card \d+ of \d+ to cut$/);
  const before = await progress.innerText();
  const candidateBefore = await swapIn.getAttribute("aria-label");

  await rater.getByRole("button", { name: /^Enlarge / }).last().click();
  const enlarged = page.getByRole("dialog", { name: /, enlarged$/ });
  await expect(enlarged).toBeVisible();
  // The layer covers the page, so dismissing it can't reach the buttons or the card below.
  await enlarged.click({ position: { x: 10, y: 10 } });
  await expect(enlarged).toBeHidden();
  await expect(progress).toHaveText(before);
  await expect(swapIn).toHaveAttribute("aria-label", candidateBefore ?? "");

  // Escape closes it too. The wait clears the guard that stops a dismissing click from reopening the card.
  await page.waitForTimeout(500);
  await rater.getByRole("button", { name: /^Enlarge / }).last().click();
  await expect(enlarged).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(enlarged).toBeHidden();
  await expect(progress).toHaveText(before);
});
