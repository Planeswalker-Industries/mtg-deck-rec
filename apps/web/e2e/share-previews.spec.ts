import sharp from "sharp";
import { CRAWLER_UA, expect, headMeta as meta, test } from "./fixtures";

/** A JPEG plate is about 100 KB; twice that means the encoder setting or the format regressed. */
const MAX_PLATE_BYTES = 200_000;
const localData = Boolean(process.env.E2E_LOCAL_DATA);
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
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  const body = await res.body();
  expect(body.length).toBeLessThan(MAX_PLATE_BYTES);
  const { format, width, height } = await sharp(body).metadata();
  expect({ format, width, height }).toEqual({ format: "jpeg", width: 1200, height: 630 });

  const crawler = await browser.newContext({ userAgent: CRAWLER_UA });
  const page = await crawler.newPage();
  await page.goto("/card/sol-ring");
  expect(await meta(page, "og:image")).toContain("/card/sol-ring/opengraph-image");
  expect(await meta(page, "twitter:image")).toContain("/card/sol-ring/opengraph-image");
  expect(await meta(page, "og:title")).toBe("Sol Ring");
  expect(await meta(page, "og:description")).not.toContain("{");
  await crawler.close();
});

test("an unknown card has no plate", async ({ request }) => {
  expect((await request.get("/card/not-a-real-card/opengraph-image")).status()).toBe(404);
});

test("a commander page shares its plate", async ({ browser, request }) => {
  test.skip(!localData, "needs the synced catalog");
  const res = await request.get("/commander/liesa-forgotten-archangel/opengraph-image");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  expect((await res.body()).length).toBeLessThan(MAX_PLATE_BYTES);
  const crawler = await browser.newContext({ userAgent: CRAWLER_UA });
  const page = await crawler.newPage();
  await page.goto("/commander/liesa-forgotten-archangel");
  expect(await meta(page, "og:image")).toContain("/commander/liesa-forgotten-archangel/opengraph-image");
  expect(await meta(page, "twitter:image")).toContain("/commander/liesa-forgotten-archangel/opengraph-image");
  expect(await meta(page, "og:title")).toBe("Liesa, Forgotten Archangel decks");
  await crawler.close();
});
