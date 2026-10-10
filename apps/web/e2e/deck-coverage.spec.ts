import { expect, test, type Page, type Request, type Route, type TestInfo } from "@playwright/test";

const DECK = [
  "Commander",
  "1 Chulane, Teller of Tales",
  "",
  "Deck",
  "2 Sol Ring",
  "1 Arcane Signet",
  "1 Cultivate",
  "1 Counterspell",
  "1 Swords to Plowshares",
  "1 Lightning Bolt",
  "1 Command Tower",
].join("\n");
// The collection fixture imports Sol Ring after its commander.
const SOL_RING_ROW_NO = 2;
// One increment of the imported Sol Ring must persist as two copies.
const EDITED_SOL_RING_QUANTITY_COPIES = 2;
// Allow the same persistence window as the saved collection UI before leaving the editor.
const COLLECTION_PERSIST_TIMEOUT_MS = 30_000;
// The optional commander lookup prompt appears immediately after analysis.
const OPTIONAL_LOOKUP_TIMEOUT_MS = 3_000;
// The phone layout must fit swipe controls above its dock at the acceptance viewport.
const PHONE_VIEWPORT_WIDTH_PX = 390;
const PHONE_VIEWPORT_HEIGHT_PX = 844;
// The desktop acceptance viewport exercises the wide swipe and keyboard controls.
const DESKTOP_VIEWPORT_WIDTH_PX = 1440;
const DESKTOP_VIEWPORT_HEIGHT_PX = 900;
// Real catalog reads and image loading get the same window as deck analysis.
const COVERAGE_CHECK_TIMEOUT_MS = 60_000;
// DeckBar must retain the two rows budgeted for the swipe layout.
const DECK_BAR_ROW_COUNT = 2;
// Compact phone controls keep the shared minimum touch target.
const PHONE_HIT_AREA_PX = 44;
const COVERAGE_VIEWPORTS = [
  { width: PHONE_VIEWPORT_WIDTH_PX, height: PHONE_VIEWPORT_HEIGHT_PX },
  { width: DESKTOP_VIEWPORT_WIDTH_PX, height: DESKTOP_VIEWPORT_HEIGHT_PX },
];

function coverageActionInput(request: Request) {
  if (request.method() !== "POST" || !request.headers()["next-action"]) return null;
  try {
    const args = JSON.parse(request.postData() ?? "null");
    if (!Array.isArray(args) || args.length !== 1) return null;
    const input = args[0];
    return input && Object.keys(input).sort().join(",") === "deck,ownership"
      && input.deck && input.ownership?.kind === "session" ? input : null;
  } catch {
    return null;
  }
}

async function captureCoverage(page: Page, testInfo: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(() => page.locator("img:visible").evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).complete)),
  { timeout: COVERAGE_CHECK_TIMEOUT_MS }).toBe(true);
  const path = testInfo.outputPath(`${state}.png`);
  await page.screenshot({ path, animations: "disabled", fullPage: true });
  await testInfo.attach(state, { path, contentType: "image/png" });
}

for (const viewport of COVERAGE_VIEWPORTS) {
  test(`real coverage error and Retry do not overlap controls at ${viewport.width}px`, async ({ page }, testInfo) => {
    test.skip(process.env.E2E_LOCAL_DATA !== "1", "Requires a fresh real-data build; mocks execute in memory, not server actions.");
    await page.setViewportSize(viewport);
    await importCollection(page);

    let actionId: string | undefined;
    let actionBody: string | null = null;
    page.on("request", (request) => {
      if (coverageActionInput(request)) {
        actionId = request.headers()["next-action"];
        actionBody = request.postData();
      }
    });
    const recs = await analyze(page);
    const trigger = recs.getByRole("button", { name: /available:.*owned/ });
    await expect(trigger).toBeVisible({ timeout: COVERAGE_CHECK_TIMEOUT_MS });
    const readyCount = await trigger.textContent();
    expect(readyCount).not.toBeNull();
    await expect.poll(() => Boolean(actionId && actionBody)).toBe(true);
    const targetedActionId = actionId;
    const targetedBody = actionBody;
    const bar = recs.locator("[data-deck-bar]");
    const readyHeight = (await bar.boundingBox())!.height;
    await captureCoverage(page, testInfo, "ready");

    // Both swipe controls must fit, not just the first visible control.
    const cutRegion = recs.getByRole("region", { name: "Cards to cut" });
    for (const name of ["Cut Lightning Bolt", "Keep Lightning Bolt"]) {
      const control = cutRegion.getByRole("button", { name, exact: true });
      await expect(control).toBeVisible({ timeout: COVERAGE_CHECK_TIMEOUT_MS });
      await expect(control).toBeInViewport();
      const box = (await control.boundingBox())!;
      const dock = page.locator("[data-deck-stats-dock]:visible");
      const dockBox = await dock.count() ? await dock.boundingBox() : null;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(dockBox?.y ?? viewport.height);
    }
    await captureCoverage(page, testInfo, "swipe-controls");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Your collection and this deck" });
    await expect(sheet).toBeVisible();
    await captureCoverage(page, testInfo, "sheet");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    let holding = true;
    let heldRequests = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holdCoverage = async (route: Route) => {
      const request = route.request();
      if (holding && request.headers()["next-action"] === targetedActionId
        && request.postData() === targetedBody && coverageActionInput(request)) {
        heldRequests++;
        await gate;
        await route.abort("failed");
      } else {
        await route.fallback();
      }
    };
    await page.route("**/*", holdCoverage);
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const loading = bar.getByRole("status").filter({ hasText: "Checking collection…" });
      await expect(loading).toBeVisible();
      await expect.poll(() => heldRequests).toBeGreaterThan(0);
      await expect(trigger).toHaveCount(0);
      await expect(recs.getByText(readyCount!, { exact: true })).toHaveCount(0);
      await captureCoverage(page, testInfo, "loading");
      holding = false;
      release();
      const error = bar.getByRole("status").filter({ hasText: "Coverage unavailable" });
      await expect(error).toHaveText(/Coverage unavailable\s*Retry/);
      await expect(error).toBeVisible();
      await expect(trigger).toHaveCount(0);
      await expect(recs.getByText(readyCount!, { exact: true })).toHaveCount(0);
      expect((await bar.boundingBox())!.height).toBe(readyHeight);
      expect(await bar.evaluate((node) => getComputedStyle(node).gridTemplateRows.split(" ").length)).toBe(DECK_BAR_ROW_COUNT);
      expect(await error.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

      // Assert the full text/Retry group against every bar control, including
      // My collection, Edit decklist, Bracket, name/issues and commander link.
      // Colour icons are deliberately excluded: their overlap is owner-approved.
      const errorBox = (await error.boundingBox())!;
      expect(errorBox.x).toBeGreaterThanOrEqual(0);
      expect(errorBox.x + errorBox.width).toBeLessThanOrEqual(viewport.width);
      const retry = error.getByRole("button", { name: "Retry", exact: true });
      for (const control of await bar.locator("button, a").all()) {
        if (await control.evaluate((node) => Boolean(node.closest('[role="status"]')))) continue;
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(errorBox.x + errorBox.width <= box.x || box.x + box.width <= errorBox.x
          || errorBox.y + errorBox.height <= box.y || box.y + box.height <= errorBox.y,
        `Coverage error overlaps ${await control.getAttribute("aria-label") ?? await control.textContent()}`).toBe(true);
      }
      if (viewport.width === PHONE_VIEWPORT_WIDTH_PX) {
        const hitArea = await retry.evaluate((node) => {
          const style = getComputedStyle(node, "::after");
          return { width: parseFloat(style.minWidth), height: parseFloat(style.minHeight) };
        });
        expect(hitArea.width).toBeGreaterThanOrEqual(PHONE_HIT_AREA_PX);
        expect(hitArea.height).toBeGreaterThanOrEqual(PHONE_HIT_AREA_PX);
      }
      await captureCoverage(page, testInfo, "error");
      await retry.focus();
      await page.keyboard.press(viewport.width === PHONE_VIEWPORT_WIDTH_PX ? "Enter" : "Space");
      await expect(trigger).toHaveText(readyCount!, { timeout: COVERAGE_CHECK_TIMEOUT_MS });
      await expect(error).toHaveCount(0);
    } finally {
      holding = false;
      release();
      await page.unroute("**/*", holdCoverage);
    }
  });
}

async function expectPersistedSolRingQuantity(page: Page) {
  await expect.poll(() => page.evaluate(async (ringRowNo) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mtg-deck-rec", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number | undefined>((resolve, reject) => {
        const transaction = db.transaction("collection", "readonly");
        const request = transaction.objectStore("collection").get("current");
        let quantity: number | undefined;
        request.onsuccess = () => {
          const stored = request.result as { rows: { rowNo: number; quantity: number }[] } | undefined;
          quantity = stored?.rows.find((row) => row.rowNo === ringRowNo)?.quantity;
        };
        transaction.oncomplete = () => resolve(quantity);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }, SOL_RING_ROW_NO), { timeout: COLLECTION_PERSIST_TIMEOUT_MS }).toBe(EDITED_SOL_RING_QUANTITY_COPIES);
}

async function importCollection(page: Page) {
  await page.goto("/collection/import");
  await page.getByLabel("Collection export").fill("1 Chulane, Teller of Tales\n1 Sol Ring");
  await page.getByRole("button", { name: "Import collection" }).click();
  await expect(page.getByRole("region", { name: "Saved collection" })).toBeVisible({ timeout: 30_000 });
}

async function analyze(page: Page) {
  await page.goto("/deck");
  await page.getByRole("textbox", { name: "Decklist" }).fill(DECK);
  await page.getByRole("button", { name: "Analyze deck" }).click();
  const recs = page.getByRole("region", { name: "Recommendations" });
  await expect(recs).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: OPTIONAL_LOOKUP_TIMEOUT_MS }).catch(() => undefined);
  return recs;
}

test("coverage stays absent without a collection", async ({ page }) => {
  const recs = await analyze(page);
  await expect(recs.getByRole("button", { name: /available:.*owned/ })).toHaveCount(0);
  await expect(recs.getByText("9 cards")).toBeVisible();
});

test("browser quantities and a live round update the two-line summary and the keyboard sheet", async ({ page }) => {
  await page.setViewportSize({ width: PHONE_VIEWPORT_WIDTH_PX, height: PHONE_VIEWPORT_HEIGHT_PX });
  await importCollection(page);

  const recs = await analyze(page);
  const trigger = recs.getByRole("button", { name: /available:.*owned/ });
  await expect(trigger).toHaveText("2/9 available", { timeout: 60_000 });
  const cutControl = recs.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: "Cut Lightning Bolt", exact: true });
  await expect(cutControl).toBeVisible({ timeout: 60_000 });
  await expect(cutControl).toBeInViewport();
  const keepControl = recs.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: "Keep Lightning Bolt", exact: true });
  const statsDock = page.locator("[data-deck-stats-dock]:visible");
  await expect(statsDock).toBeVisible();
  for (const control of [cutControl, keepControl]) {
    await expect(control).toBeVisible();
    await expect(control).toBeInViewport();
    await expect(async () => {
      const controlBox = await control.boundingBox();
      const dockBox = await statsDock.boundingBox();
      expect(controlBox).not.toBeNull();
      expect(dockBox).not.toBeNull();
      expect(controlBox!.x).toBeGreaterThanOrEqual(0);
      expect(controlBox!.y).toBeGreaterThanOrEqual(0);
      expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(PHONE_VIEWPORT_WIDTH_PX);
      expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(dockBox!.y);
    }).toPass();
  }
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Your collection and this deck" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("1× Sol Ring")).toHaveCount(2);
  await expect(sheet.getByRole("region", { name: "Not owned" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Both imported card ids remain the same; changing only a quantity must refresh the deck tool's input.
  await page.goto("/collection");
  await page.getByRole("button", { name: "Edit collection" }).click();
  await page.getByRole("button", { name: "One more Sol Ring" }).click();
  await expect(page.getByLabel("2 copies of Sol Ring")).toBeVisible();
  await expectPersistedSolRingQuantity(page);
  // Returning to the tool offers the remembered deck before its editor is accessible.
  await page.goto("/deck");
  await page.getByRole("dialog", { name: "Continue with Chulane, Teller of Tales?" })
    .getByRole("button", { name: "Yes", exact: true }).click();
  await expect(recs).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: OPTIONAL_LOOKUP_TIMEOUT_MS }).catch(() => undefined);
  await expect(trigger).toHaveText("3/9 available", { timeout: 60_000 });
  await expect(trigger).toHaveAttribute("aria-label", /3 owned, 0 stand-in, 0 basic lands, 0 conflicts, 6 missing/);

  // Check desktop swipe controls while Bolt is still queued, before keeping it in the round.
  await page.setViewportSize({ width: DESKTOP_VIEWPORT_WIDTH_PX, height: DESKTOP_VIEWPORT_HEIGHT_PX });
  await recs.getByRole("group", { name: "How to review cards" }).getByRole("button", { name: "Swipe" }).click();
  await expect(cutControl).toBeVisible({ timeout: 60_000 });
  await expect(cutControl).toBeInViewport();
  await expect(keepControl).toBeVisible();
  await expect(keepControl).toBeInViewport();
  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.setViewportSize({ width: PHONE_VIEWPORT_WIDTH_PX, height: PHONE_VIEWPORT_HEIGHT_PX });

  await recs.getByRole("button", { name: "Show as a list" }).click();
  const steps = recs.getByRole("navigation", { name: "Deck upgrade steps" });
  const bolt = recs.getByRole("region", { name: "Your deck" }).getByRole("button", { name: "Lightning Bolt Off-color", exact: true });
  await expect(bolt).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await steps.getByRole("button", { name: "Add" }).click();
  await expect(trigger).toHaveText("3/8 available", { timeout: 60_000 });
  await steps.getByRole("button", { name: "Cut" }).click();
  await bolt.click();
  await expect(trigger).toHaveText("3/9 available", { timeout: 60_000 });

  await recs.getByRole("button", { name: "Deckbuilder" }).click();
  await expect(trigger).toHaveCount(0);
  await recs.getByRole("button", { name: "Upgrade" }).click();
  await expect(trigger).toHaveText("3/9 available", { timeout: 60_000 });
});

test("same-tab quantity-only source notification refreshes live coverage", async ({ page }) => {
  await importCollection(page);
  const recs = await analyze(page);
  const trigger = recs.getByRole("button", { name: /available:.*owned/ });
  await expect(trigger).toHaveText("2/9 available", { timeout: 60_000 });

  // Edit the existing IndexedDB row without changing the set of card ids, then use the same notification as hand edits.
  await page.evaluate(async (ringRowNo) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mtg-deck-rec", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("collection", "readwrite");
        const store = transaction.objectStore("collection");
        const request = store.get("current");
        request.onsuccess = () => {
          const stored = request.result;
          // The import above puts Sol Ring in its second parsed row.
          const ring = stored.rows.find((row: { rowNo: number }) => row.rowNo === ringRowNo);
          ring.quantity = 2;
          store.put(stored, "current");
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
    window.dispatchEvent(new Event("mtg-deck-rec:collection-changed"));
  }, SOL_RING_ROW_NO);

  await expect(trigger).toHaveText("3/9 available", { timeout: 60_000 });
});

test("cross-tab edits and clearing the collection are read again on focus", async ({ page, context }) => {
  await importCollection(page);
  const recs = await analyze(page);
  const trigger = recs.getByRole("button", { name: /available:.*owned/ });
  await expect(trigger).toHaveText("2/9 available", { timeout: 60_000 });

  const other = await context.newPage();
  await other.goto("/collection");
  await other.getByRole("button", { name: "Edit collection" }).click();
  await other.getByRole("button", { name: "One more Sol Ring" }).click();
  await expect(other.getByLabel("2 copies of Sol Ring")).toBeVisible();
  await expectPersistedSolRingQuantity(other);
  await other.reload();
  await expect(other.getByText("×2")).toBeVisible({ timeout: 30_000 });

  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(trigger).toHaveText("3/9 available", { timeout: 60_000 });

  await other.goto("/collection/import");
  await other.getByRole("button", { name: "Clear collection" }).click();
  await expect(other.getByRole("region", { name: "Saved collection" })).toBeHidden();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(trigger).toHaveCount(0);
  await expect(recs.getByText("9 cards")).toBeVisible();
  await other.close();
});
