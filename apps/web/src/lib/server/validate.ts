import type { ApiError, Bracket, DeckCardEntry, DeckSection, RecContext, Result } from "@mtg/core/contract";

const SECTIONS: ReadonlySet<DeckSection> = new Set(["commander", "main", "sideboard", "maybeboard", "companion"]);
const MAX_DECK_ENTRIES = 400;
const MAX_OWNED_CARDS = 60_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCardId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const invalid = (message: string): { ok: false; error: ApiError } => ({ ok: false, error: { code: "VALIDATION", message } });

/** Runtime check for RecContext bodies posted to /api/recs/*. Returns the typed context or a VALIDATION error. */
export function parseRecContext(value: unknown): Result<RecContext> {
  if (!isRecord(value) || !isRecord(value.deck)) return invalid("Missing deck.");
  const { commanders, cards } = value.deck;
  if (!Array.isArray(commanders) || commanders.length > 2 || !commanders.every(isCardId)) return invalid("Invalid commanders.");
  if (!Array.isArray(cards) || cards.length > MAX_DECK_ENTRIES) return invalid("Invalid deck cards.");

  const entries: DeckCardEntry[] = [];
  for (const entry of cards) {
    if (
      !isRecord(entry) ||
      !isCardId(entry.cardId) ||
      !Number.isInteger(entry.quantity) ||
      (entry.quantity as number) < 1 ||
      (entry.quantity as number) > 250 ||
      !SECTIONS.has(entry.section as DeckSection)
    ) {
      return invalid("Invalid deck card entry.");
    }
    entries.push({ cardId: entry.cardId as DeckCardEntry["cardId"], quantity: entry.quantity as number, section: entry.section as DeckSection });
  }

  const bracket = value.bracket;
  if (![1, 2, 3, 4, 5].includes(bracket as number)) return invalid("Invalid bracket.");
  if (value.bracketSource !== "inferred" && value.bracketSource !== "user") return invalid("Invalid bracket source.");
  if (typeof value.includeGameChangers !== "boolean") return invalid("Invalid Game Changer setting.");

  let ownership: RecContext["ownership"] = null;
  if (value.ownership !== null && value.ownership !== undefined) {
    const o = value.ownership;
    if (isRecord(o) && o.kind === "session" && typeof o.catalogEpoch === "string" && Array.isArray(o.ownedCardIds)) {
      if (o.ownedCardIds.length > MAX_OWNED_CARDS || !o.ownedCardIds.every(isCardId)) return invalid("Invalid collection.");
      ownership = { kind: "session", catalogEpoch: o.catalogEpoch, ownedCardIds: o.ownedCardIds as RecContext["deck"]["commanders"] };
    } else if (isRecord(o) && o.kind === "account") {
      return { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to use your saved collection." } };
    } else {
      return invalid("Invalid collection.");
    }
  }

  return {
    ok: true,
    data: {
      deck: { commanders: commanders as RecContext["deck"]["commanders"], cards: entries },
      bracket: bracket as Bracket,
      bracketSource: value.bracketSource,
      includeGameChangers: value.includeGameChangers,
      ownership,
    },
  };
}

export function parseOptionalLimit(value: unknown, max: number): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : undefined;
}
