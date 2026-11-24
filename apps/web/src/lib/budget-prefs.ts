import type { DeckBudget } from "@mtg/core/contract";
import { deckBudgetSchema } from "@mtg/core/schemas";

/**
 * The build start's budget, remembered in this browser for each list it builds from: "From my collection" and "Any
 * commander". A player who sets one finds it again on the next visit; one who never has gets the defaults below.
 */
export type BudgetPrefMode = "collection" | "any";

/** The storage keys, one per field and list, named like the app's other keys. */
const USER_PREF_COLLECTION_CARD_MAX_KEY = "mtg-deck-rec:pref-collection-card-max";
const USER_PREF_COLLECTION_DECK_MAX_KEY = "mtg-deck-rec:pref-collection-deck-max";
const USER_PREF_ANY_CARD_MAX_KEY = "mtg-deck-rec:pref-any-card-max";
const USER_PREF_ANY_DECK_MAX_KEY = "mtg-deck-rec:pref-any-deck-max";
const PREF_KEYS: Record<BudgetPrefMode, Record<keyof DeckBudget, string>> = {
  collection: { cardCapUsd: USER_PREF_COLLECTION_CARD_MAX_KEY, spendUsd: USER_PREF_COLLECTION_DECK_MAX_KEY },
  any: { cardCapUsd: USER_PREF_ANY_CARD_MAX_KEY, spendUsd: USER_PREF_ANY_DECK_MAX_KEY },
};

/** From the collection, $0 each: build from cards the player owns until they say otherwise. */
const COLLECTION_DEFAULT_BUDGET: DeckBudget = { cardCapUsd: 0, spendUsd: 0 };
/** Any commander: about the price of a mid-range staple per card and a preconstructed deck in all. */
const ANY_DEFAULT_CARD_MAX_USD = 10;
const ANY_DEFAULT_DECK_MAX_USD = 100;
const ANY_DEFAULT_BUDGET: DeckBudget = { cardCapUsd: ANY_DEFAULT_CARD_MAX_USD, spendUsd: ANY_DEFAULT_DECK_MAX_USD };

const DEFAULT_BUDGET: Record<BudgetPrefMode, DeckBudget> = { collection: COLLECTION_DEFAULT_BUDGET, any: ANY_DEFAULT_BUDGET };

/** A field the player cleared: kept as "no limit", so the default doesn't come back on the next visit. */
const NO_LIMIT = "none";

const FIELDS = ["cardCapUsd", "spendUsd"] as const satisfies readonly (keyof DeckBudget)[];

/** The budget to start the build form with for this list: the player's last one, field by field, else the default. */
export function readBudgetPref(mode: BudgetPrefMode): DeckBudget | undefined {
  const budget: DeckBudget = {};
  for (const field of FIELDS) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PREF_KEYS[mode][field]);
    } catch {
      // Storage is blocked: the default stands.
    }
    if (stored === NO_LIMIT) continue;
    const amount = stored === null ? undefined : Number(stored);
    const value = amount !== undefined && deckBudgetSchema.safeParse({ [field]: amount }).success ? amount : DEFAULT_BUDGET[mode][field];
    if (value !== undefined) budget[field] = value;
  }
  return FIELDS.some((field) => budget[field] !== undefined) ? budget : undefined;
}

/** Remembers the budget the player set on the build form for this list; a blank field is remembered as no limit. */
export function writeBudgetPref(mode: BudgetPrefMode, budget: DeckBudget | undefined): void {
  try {
    for (const field of FIELDS) {
      const amount = budget?.[field];
      localStorage.setItem(PREF_KEYS[mode][field], amount === undefined ? NO_LIMIT : String(amount));
    }
  } catch {
    // Storage is blocked; the budget just won't be remembered.
  }
}
