import { expect, test, type Page } from "@playwright/test";

/**
 * Read-only smoke run against a deployed site (T082): `yarn workspace @mtg/web smoke`, production by default. It only
 * loads pages, as an anonymous visitor would. It never signs in, fills a form or calls a recommendation route, and it
 * fails if a page sends any POST (Server Actions and the rate-limited API routes are POSTs), so it writes nothing.
 * The one allowed POST is LOAD_ACTION_PATHS below.
 */

/**
 * Pages whose load sends one Server Action with no arguments: the deck tool asks `getAccountCollectionAction` whether
 * the visitor is signed in. For a signed-out visitor it reads only the session cookie, so it touches no database.
 */
const LOAD_ACTION_PATHS = new Set(["/deck"]);

/** Cold serverless starts on production can take several seconds per page. */
const PAGE_TIMEOUT_MS = 30_000;

const PAGES = [
  { path: "/", heading: "Build better decks." },
  { path: "/deck", heading: null },
  { path: "/card/sol-ring", heading: "Sol Ring" },
  { path: "/commander/liesa-forgotten-archangel", heading: "Liesa, Forgotten Archangel" },
  { path: "/privacy", heading: null },
  { path: "/sign-in", heading: "Sign in" },
] as const;

const MISSING = ["/card/not-a-real-card", "/commander/not-a-commander", "/no-such-page"];

test.describe.configure({ timeout: PAGE_TIMEOUT_MS * 2 });

/** Collects page errors, failed console errors and any POST the page sends, for the checks after a load. */
function watch(page: Page, path: string) {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console error: ${msg.text()}`);
  });
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const loadAction = LOAD_ACTION_PATHS.has(path) && new URL(req.url()).pathname === path && req.postData() === "[]";
    if (!loadAction) problems.push(`POST ${req.url()} ${req.postData() ?? ""}`);
  });
  return problems;
}

/** Every card image on the page has loaded; an image that failed has a natural width of 0. */
async function expectImagesLoaded(page: Page) {
  const images = page.locator('img[src*="cards.scryfall.io"]');
  await expect(images.first()).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  await expect
    .poll(
      () => images.evaluateAll((imgs) => (imgs as HTMLImageElement[]).filter((img) => img.complete && img.naturalWidth === 0).length),
      { timeout: PAGE_TIMEOUT_MS },
    )
    .toBe(0);
}

for (const { path, heading } of PAGES) {
  test(`${path} loads without errors or writes`, async ({ page }) => {
    const problems = watch(page, path);
    const res = await page.goto(path, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
    expect(res?.status(), path).toBe(200);
    const h1 = page.getByRole("heading", { level: 1 }).first();
    await expect(h1).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
    if (heading) await expect(h1).toContainText(heading);
    await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS });
    expect(problems, path).toEqual([]);
  });
}

test("card and commander pages show their card images", async ({ page }) => {
  for (const path of ["/card/sol-ring", "/commander/liesa-forgotten-archangel"]) {
    await page.goto(path, { timeout: PAGE_TIMEOUT_MS });
    await expectImagesLoaded(page);
  }
});

test("the deck tool offers the decklist box", async ({ page }) => {
  await page.goto("/deck", { timeout: PAGE_TIMEOUT_MS });
  await expect(page.getByRole("textbox", { name: "Decklist" })).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "Analyze deck", exact: true })).toBeVisible();
});

test("sign-in offers Google only (T080)", async ({ page }) => {
  await page.goto("/sign-in", { timeout: PAGE_TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible({ timeout: PAGE_TIMEOUT_MS });
  await expect(page.getByLabel("Email")).toHaveCount(0);
});

for (const path of MISSING) {
  test(`${path} returns a real 404 with noindex`, async ({ request }) => {
    const res = await request.get(path, { timeout: PAGE_TIMEOUT_MS });
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain('name="robots" content="noindex"');
  });
}

test("robots.txt and the sitemap list the public pages", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("sitemap.xml");

  const sitemap = await request.get("/sitemap.xml", { timeout: PAGE_TIMEOUT_MS });
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain("/commander/");
  expect(xml).toContain("/card/sol-ring</loc>");
});
