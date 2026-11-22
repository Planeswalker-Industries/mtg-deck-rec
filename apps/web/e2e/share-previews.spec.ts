import { expect, test, type Page } from "@playwright/test";

const localData = Boolean(process.env.E2E_LOCAL_DATA);
/** A PNG's IHDR holds its width and height as big-endian 32-bit integers at these byte offsets. */
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
/**
 * Facebook's link-preview crawler. Next streams a dynamic page's metadata into the body for browsers and blocks on it
 * only for crawlers it knows, so the head a share preview reads is the one this user agent gets.
 */
const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** The content of one head meta tag, by its `property` (Open Graph) or `name` (X) attribute. */
const meta = (page: Page, key: string) =>
  page.locator(`head meta[property="${key}"], head meta[name="${key}"]`).first().getAttribute("content");

test("every page has the default preview image", async ({ page }) => {
  for (const path of ["/", "/privacy"]) {
    await page.goto(path);
    expect(await meta(page, "og:image"), path).toMatch(/\/og\/hero\.png$/);
    expect(await meta(page, "og:image:width"), path).toBe("1200");
    expect(await meta(page, "og:image:height"), path).toBe("630");
    expect(await meta(page, "og:site_name"), path).toBe("Spell Chasm");
    expect(await meta(page, "twitter:card"), path).toBe("summary_large_image");
  }
});

test("a card page shares its plate", async ({ browser, request }) => {
  test.skip(!localData, "needs the synced catalog");
  const res = await request.get("/card/sol-ring/opengraph-image");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const png = await res.body();
  expect(png.readUInt32BE(PNG_WIDTH_OFFSET)).toBe(1200);
  expect(png.readUInt32BE(PNG_HEIGHT_OFFSET)).toBe(630);

  const crawler = await browser.newContext({ userAgent: CRAWLER_UA });
  const page = await crawler.newPage();
  await page.goto("/card/sol-ring");
  expect(await meta(page, "og:image")).toContain("/card/sol-ring/opengraph-image");
  expect(await meta(page, "twitter:image")).toContain("/card/sol-ring/opengraph-image");
  expect(await meta(page, "og:title")).toBe("Sol Ring");
  await crawler.close();
});

test("an unknown card has no plate", async ({ request }) => {
  expect((await request.get("/card/not-a-real-card/opengraph-image")).status()).toBe(404);
});
