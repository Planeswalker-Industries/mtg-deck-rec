import { expect, test } from "@playwright/test";
import { mailpit, signIn } from "./mailpit";

/**
 * The admin area's guard, from outside. The three answers it can give are the point: a redirect when signed out, a
 * real 404 for a signed-in visitor who isn't a platform admin, and the app itself for one who is.
 *
 * The seeded admin (supabase/seed.sql) is the only platform admin locally, so signing in with any other address is
 * enough to be the non-admin case.
 */

test("signed out, /admin redirects to sign in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin$/);
});

test("signed out, the admin API refuses", async ({ request }) => {
  const res = await request.get("/api/admin/users");
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
});

test("a signed-in visitor who isn't an admin gets a real 404", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");

  await signIn(page, request, `e2e-admin-${Date.now()}@example.com`, "/decks");

  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

  // The API answers the same way, so nothing about the area is confirmed by either door.
  const api = await page.request.get("/api/admin/users");
  expect(api.status()).toBe(404);
});

test("a platform admin sees the user list and can rename someone", async ({ page, request }) => {
  test.skip(!mailpit, "needs the local mail catcher (E2E_MAILPIT_URL)");
  test.setTimeout(120_000);
  // React Admin's datagrid is a desktop tool; the rest of the suite runs at phone width.
  await page.setViewportSize({ width: 1280, height: 900 });

  // Signed in somewhere neutral first: /admin sends the browser straight on to its default screen, so it is never
  // the URL the sign-in flow lands on.
  await signIn(page, request, "admin@test.local", "/decks");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/users$/, { timeout: 60_000 });

  const users = page.getByRole("table");
  await expect(users).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("menuitem", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Platform admins" })).toBeVisible();
  // Searched rather than read off the first page. The list is sorted newest first, and both the demo cast and every
  // e2e run add accounts, so which rows page one happens to hold is not something this test should rest on.
  const search = page.getByPlaceholder("Email, name or id");
  await search.fill("@test.local");
  await expect(users.getByText("admin@test.local")).toBeVisible({ timeout: 30_000 });
  await expect(users.getByText("anon@test.local")).toBeVisible();
  await search.fill("");

  // The admins-only view is the same list with the filter pinned on.
  await page.getByRole("menuitem", { name: "Platform admins" }).click();
  await expect(page.getByRole("table").getByText("admin@test.local")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("table").getByText("anon@test.local")).toHaveCount(0);

  // Renaming someone goes through the API and comes back on the record.
  const name = `Renamed ${Date.now()}`;
  const anon = await page.request.get("/api/admin/users?q=anon@test.local");
  const anonId = (await anon.json()).data.users[0].id as string;
  await page.goto(`/admin/users/${anonId}`);
  const displayName = page.getByLabel("Display name");
  await expect(displayName).toBeVisible({ timeout: 30_000 });
  await displayName.fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

  // Put it back, so a rerun starts where this one did.
  const restore = await page.request.patch(`/api/admin/users/${anonId}`, { data: { displayName: "Test anon" } });
  expect(restore.ok()).toBe(true);

  // The guard that matters most: nobody can lock themselves out of the area they administer. Asserted in the same
  // test as the rest because every sign-in spends one of the local email budget the whole suite shares.
  const me = await page.request.get("/api/admin/users?adminsOnly=1");
  const myId = (await me.json()).data.users[0].id as string;
  const selfRevoke = await page.request.patch(`/api/admin/users/${myId}`, { data: { isAdmin: false } });
  expect(selfRevoke.status()).toBe(400);
  expect((await selfRevoke.json()).error.message).toContain("your own platform admin access");
});
