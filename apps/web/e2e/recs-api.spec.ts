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

  const noDeck = await post(request, "/api/recs/fix", {}, visitor("fix"));
  expect(noDeck.status()).toBe(400);
  const badLine = await post(request, "/api/recs/fix", { context: { ...context, buyFor: [""] } }, visitor("line"));
  expect(badLine.status()).toBe(400);
  expect((await badLine.json()).error.message).toBe("Invalid Deck stats line.");

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

  // Fix has its own budget: a visitor out of recommendation requests can still ask for it.
  const fix = await post(request, "/api/recs/fix", {}, from);
  expect(fix.status()).toBe(400);

  // Hosts like Vercel replace x-forwarded-for with the caller's real address, so a made-up second visitor can only be
  // told apart on a server this suite runs itself.
  if (!/^https:\/\//.test(process.env.E2E_BASE_URL ?? "")) {
    const someoneElse = await post(request, "/api/recs/cut", {}, visitor("other"));
    expect(someoneElse.status()).toBe(400);
  }
});

test("hands Fix its pool for a real deck", async ({ request }) => {
  test.skip(!process.env.E2E_LOCAL_DATA, "the pool needs the synced catalog and corpus (E2E_LOCAL_DATA)");
  const search = await request.get("/api/cards/search?q=Liesa%2C%20Forgotten%20Archangel&commander=1&limit=1");
  const commander = (await search.json()).data[0];
  const basic = (await (await request.get("/api/cards/search?q=Plains&limit=20")).json()).data.find((c: { name: string }) => c.name === "Plains");
  const deck = { commanders: [commander.id], cards: [{ cardId: basic.id, quantity: 30, section: "main" }] };

  const res = await post(request, "/api/recs/fix", { context: { ...context, deck } }, visitor("pool"));
  expect(res.status()).toBe(200);
  const { pool, illegalIds } = (await res.json()).data;
  // Every main-deck card to take out, basic lands included, and cards to bring in that carry their roles.
  expect(pool.deck.map((c: { card: { name: string } }) => c.card.name)).toEqual(["Plains"]);
  expect(pool.ins.length).toBeGreaterThan(20);
  expect(pool.ins.every((c: { score: number; card: { roles?: string[] } }) => c.score >= 0 && c.score <= 1 && Array.isArray(c.card.roles))).toBe(true);
  expect(pool.ins.some((c: { card: { name: string } }) => c.card.name === "Plains")).toBe(true);
  expect(illegalIds).toEqual([]);
});
