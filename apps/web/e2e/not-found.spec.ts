import { expect, test } from "@playwright/test";

const localData = Boolean(process.env.E2E_LOCAL_DATA);

for (const path of ["/card/not-a-real-card", "/commander/not-a-commander", "/no-such-page"]) {
  test(`${path} returns a real 404 with noindex`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain('name="robots" content="noindex"');
  });
}

test("the deck tool page loads", async ({ request }) => {
  expect((await request.get("/deck")).status()).toBe(200);
});

test("existing card and commander pages load", async ({ request }) => {
  test.skip(!localData, "needs the synced catalog and deck corpus");
  for (const path of ["/card/sol-ring", "/commander/liesa-forgotten-archangel"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("a missing page shows the not-found page in the browser", async ({ page }) => {
  const res = await page.goto("/card/not-a-real-card");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
});
