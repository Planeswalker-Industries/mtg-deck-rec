import { TOURS_ENABLED_KEY, TOURS_SEEN_KEY } from "../src/lib/constants";
import { expect, test, type Page } from "./fixtures";
import { mailpit, signIn } from "./mailpit";

// Every other spec runs with tours off (playwright.config.ts); these start from an empty browser, where they are on.
test.use({ storageState: { cookies: [], origins: [] } });

const tutorials = (page: Page) => page.getByRole("switch", { name: "Tutorials" });
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

async function signInToAccount(page: Page, request: Parameters<typeof signIn>[1]) {
  await signIn(page, request, `e2e-tours-${Date.now()}@example.com`, "/account");
  await expect(tutorials(page)).toBeVisible({ timeout: 30_000 });
}

test("the Tutorials switch defaults on and turns off", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await signInToAccount(page, request);
  await expect(tutorials(page)).toBeChecked();

  await page.getByRole("button", { name: "Tutorials: What this does" }).click();
  await expect(page.getByRole("dialog", { name: "Tutorials" })).toContainText("once on this device");
  await page.keyboard.press("Escape");

  await tutorials(page).click();
  await expect(tutorials(page)).not.toBeChecked();
  expect(await stored(page, TOURS_ENABLED_KEY)).toBe("0");

  await page.reload();
  await expect(tutorials(page)).not.toBeChecked();
});

test("turning tutorials on clears the seen list", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await signInToAccount(page, request);
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify(["commander"])), TOURS_SEEN_KEY);
  await page.reload();

  await tutorials(page).click();
  await expect(tutorials(page)).not.toBeChecked();
  expect(JSON.parse((await stored(page, TOURS_SEEN_KEY)) ?? "null")).toEqual(["commander"]);

  await tutorials(page).click();
  await expect(tutorials(page)).toBeChecked();
  expect(await stored(page, TOURS_ENABLED_KEY)).toBe("1");
  expect(JSON.parse((await stored(page, TOURS_SEEN_KEY)) ?? "null")).toEqual([]);
});

test("blocked storage still renders the switch", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  await signInToAccount(page, request);

  // As in private browsing with site data blocked: every touch of localStorage throws.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.reload();

  await expect(tutorials(page)).toBeChecked();
  await tutorials(page).click();
  await expect(tutorials(page)).not.toBeChecked();
  await tutorials(page).click();
  await expect(tutorials(page)).toBeChecked();
  expect(errors).toEqual([]);
});
