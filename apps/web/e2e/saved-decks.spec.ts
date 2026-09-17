import { expect, test } from "@playwright/test";
import { mailpit, signIn } from "./mailpit";

// Saving needs an account, so these run only where the local mail catcher is up.
test.skip(!mailpit, "set E2E_MAILPIT_URL to run the saved deck checks");

test("signed out, the deck list asks you to sign in", async ({ page }) => {
  await page.goto("/decks");
  await page.waitForURL(/\/sign-in/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/decks");
});

test("saves a deck, then renames, duplicates and deletes it from the list", async ({ page, request }) => {
  const email = `decks-${Date.now()}@test.invalid`;
  await signIn(page, request, email, "/decks");

  // A fresh account has nothing saved.
  await expect(page.getByRole("heading", { name: "No decks saved yet." })).toBeVisible();

  // Build a deck in the tool and save it.
  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);

  const save = page.getByRole("button", { name: "Save deck" });
  await expect(save).toBeVisible({ timeout: 60_000 });
  await save.click();
  const name = page.getByRole("textbox", { name: /deck name/i });
  await expect(name).toBeVisible();
  // The name is prefilled from the commander, so saving is one click.
  await expect(name).not.toHaveValue("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Fail here, not on the list, if the save itself was refused.
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/decks");
  const list = page.getByRole("listitem");
  await expect(list).toHaveCount(1);

  // Rename.
  await page.getByRole("button", { name: /^Rename / }).click();
  const rename = page.getByRole("textbox", { name: /^New name for / });
  await rename.fill("Renamed Deck");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Renamed Deck" })).toBeVisible();

  // Duplicate.
  await page.getByRole("button", { name: /^Duplicate / }).first().click();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Renamed Deck (copy)" })).toBeVisible();

  // Delete, which confirms first.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete Renamed Deck (copy)" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("a saved deck has its own page, and hiding it keeps strangers out", async ({ page, request, browser }) => {
  const email = `deckpage-${Date.now()}@test.invalid`;
  await signIn(page, request, email, "/decks");

  await page.goto("/deck");
  await page.getByRole("button", { name: "Use sample deck" }).click();
  await page.getByRole("button", { name: "Analyze deck" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Not now" }).click({ timeout: 10_000 }).catch(() => undefined);
  await page.getByRole("button", { name: "Save deck" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 30_000 });

  await page.goto("/decks");
  await page.getByRole("listitem").getByRole("link").first().click();
  // /decks/<commander-slug>/<code>: the code identifies the deck, the slug is decoration.
  await page.waitForURL(/\/decks\/[^/]+\/[A-Za-z0-9]{8,32}$/);
  const url = page.url();

  // The deck's cards are on the page, grouped by type.
  await expect(page.getByRole("heading", { name: "Lands" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Creatures" })).toBeVisible();

  // A new deck is public, so a signed-out visitor can read it.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  const asPublic = await strangerPage.goto(url);
  expect(asPublic?.status()).toBe(200);
  await expect(strangerPage.getByRole("link", { name: "Report it" })).toBeVisible();

  // Hiding it takes the page away from everyone else.
  await page.getByRole("switch").click();
  await expect(page.getByText("Only you can see this deck")).toBeVisible({ timeout: 30_000 });
  const asPrivate = await strangerPage.goto(url);
  expect(asPrivate?.status()).toBe(404);
  // And the content must not leak either way.
  await expect(strangerPage.getByRole("heading", { name: "Lands" })).toBeHidden();
  const leaked = await strangerPage.evaluate(() => document.body.innerText);
  expect(leaked).not.toContain("Sol Ring");
  await stranger.close();

  // The owner still sees it.
  await page.reload();
  await expect(page.getByText("Only you can see this deck")).toBeVisible();
});
