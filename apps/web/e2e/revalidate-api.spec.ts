import { expect, test } from "@playwright/test";

test("the cache refresh endpoint refuses requests without the shared secret", async ({ request }) => {
  const res = await request.post("/api/internal/revalidate", {
    data: { tags: ["corpus"] },
    headers: { authorization: "Bearer not-the-secret" },
  });
  // 503 when the server has no REVALIDATE_SECRET configured (as in CI), 401 when it does.
  expect([401, 503]).toContain(res.status());
  expect((await res.json()).ok).toBe(false);
});
