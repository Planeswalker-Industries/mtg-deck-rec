import { expect, test, type Page } from "@playwright/test";

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
