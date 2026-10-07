import { parseBracketRules, type BracketCards, type BracketRules } from "@mtg/core/commander";
import type { DeckBracketFacts } from "@mtg/core/scoring";
import { cachedConfig } from "./config-cache";
import type { PublicClient } from "./supabase";

/** `app_config.brackets` (public): the bracket rules' tags and limits (T060), cached per instance for a minute. */
export function loadBracketRules(db: PublicClient): Promise<BracketRules> {
  return cachedConfig("brackets", async () => {
    const { data, error } = await db.rpc("get_public_config", { p_key: "brackets" });
    if (error) throw new Error(`Loading bracket rules failed: ${error.message}`);
    return parseBracketRules(data);
  });
}

/** The cards the bracket rules watch (mass land denial, extra turns), cached like the rules. */
export function loadBracketCards(db: PublicClient): Promise<BracketCards> {
  return cachedConfig("bracket_cards", async () => {
    const { data, error } = await db.rpc("bracket_cards");
    if (error) throw new Error(`Loading bracket cards failed: ${error.message}`);
    const value = (data ?? {}) as { massLandDenial?: number[]; extraTurns?: number[] };
    return { massLandDenial: new Set(value.massLandDenial ?? []), extraTurns: new Set(value.extraTurns ?? []) };
  });
}

/** The bracket rules and the cards they watch, read together (both cached). */
export async function loadBracketBasics(db: PublicClient): Promise<Omit<DeckBracketFacts, "combos">> {
  const [rules, cards] = await Promise.all([loadBracketRules(db), loadBracketCards(db)]);
  return { rules, cards };
}
