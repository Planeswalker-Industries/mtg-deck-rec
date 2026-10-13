import { expect, test, type Page } from "@playwright/test";

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
// The phone viewport the swipe layout is budgeted for.
const PHONE_VIEWPORT_WIDTH_PX = 390;
const PHONE_VIEWPORT_HEIGHT_PX = 844;
// The desktop viewport exercises the wide swipe and keyboard controls.
const DESKTOP_VIEWPORT_WIDTH_PX = 1440;
const DESKTOP_VIEWPORT_HEIGHT_PX = 900;

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
  const keepControl = recs.getByRole("region", { name: "Cards to cut" }).getByRole("button", { name: "Keep Lightning Bolt", exact: true });
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
  const bolt = recs.getByRole("region", { name: "Your deck" }).getByRole("button", { name: /^Lightning Bolt Off-color(,|$)/ });
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
