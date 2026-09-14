import { expect, test, type APIRequestContext } from "@playwright/test";

const context = {
  deck: { commanders: [1], cards: [{ cardId: 2, quantity: 1, section: "main" }] },
  bracket: 3,
  bracketSource: "inferred",
  includeGameChangers: false,
};

/** A made-up visitor address per call site and run, so request budgets never carry over between tests or runs. */
const visitor = (name: string) => `e2e-${name}-${Date.now()}`;

function post(request: APIRequestContext, path: string, data: unknown, from: string) {
  return request.post(path, {
    data,
    headers: { "content-type": "application/json", "x-forwarded-for": from },
  });
}

test("rejects invalid bodies with readable errors", async ({ request }) => {
  const badBracket = await post(request, "/api/recs/cut", { context: { ...context, bracket: 9 } }, visitor("bracket"));
  expect(badBracket.status()).toBe(400);
  expect((await badBracket.json()).error.message).toBe("Pick a bracket from 1 to 5.");

  const noTarget = await post(request, "/api/recs/swap", { context }, visitor("target"));
  expect(noTarget.status()).toBe(400);
  expect((await noTarget.json()).error.message).toBe("Pick a card to replace.");

  const cards = Array.from({ length: 401 }, (_, i) => ({ cardId: i + 1, quantity: 1, section: "main" }));
  const oversized = await post(request, "/api/recs/add", { context: { ...context, deck: { commanders: [1], cards } } }, visitor("size"));
  expect(oversized.status()).toBe(413);
  expect((await oversized.json()).error.code).toBe("PAYLOAD_TOO_LARGE");

  const malformed = await post(request, "/api/recs/cut", "not json", visitor("malformed"));
  expect(malformed.status()).toBe(400);

  const account = await post(request, "/api/recs/cut", { context: { ...context, ownership: { kind: "account" } } }, visitor("account"));
  expect(account.status()).toBe(401);
  expect((await account.json()).error.code).toBe("UNAUTHENTICATED");
});

test("limits each visitor's recommendation requests", async ({ request }) => {
  const from = visitor("limit");
  // Invalid bodies still count against the budget, so this runs no recommendation queries.
  let limitedAt = 0;
  let limited: Awaited<ReturnType<typeof post>> | null = null;
  for (let i = 1; i <= 500 && !limited; i++) {
    const res = await post(request, "/api/recs/cut", {}, from);
    if (res.status() === 429) {
      limitedAt = i;
      limited = res;
    } else {
      expect(res.status()).toBe(400);
    }
  }
  expect(limited, "the budget should run out within 500 requests").not.toBeNull();
  expect(limitedAt).toBeGreaterThan(1);
  expect(Number(limited?.headers()["retry-after"])).toBeGreaterThan(0);
  const body = await limited?.json();
  expect(body.error.code).toBe("RATE_LIMITED");
  expect(body.error.message).toMatch(/^Too many requests\. Try again in \d+ seconds?\.$/);

  // Hosts like Vercel replace x-forwarded-for with the caller's real address, so a made-up second visitor can only be
  // told apart on a server this suite runs itself.
  if (!/^https:\/\//.test(process.env.E2E_BASE_URL ?? "")) {
    const someoneElse = await post(request, "/api/recs/cut", {}, visitor("other"));
    expect(someoneElse.status()).toBe(400);
  }
});
