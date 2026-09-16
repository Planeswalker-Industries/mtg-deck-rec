import type { CommanderCardFacts } from "@mtg/core/commander";
import { maskToIdentity } from "@mtg/core/commander";
import type { CardId, CardImages, CardSummary, Finish, OracleId } from "@mtg/core/contract";
import type { PublicClient } from "./supabase";

/** Columns needed to build a CardSummary and run Commander rules. */
export const CARD_COLUMNS =
  "id, oracle_id, name, slug, mana_value, type_line, color_identity, images, game_changer, released_at, reference_price_usd, reference_price_finish, prices_as_of, legal_commander, can_be_commander, partner_kind, partner_qualifier, copy_limit, is_basic_land, artist" as const;

export interface CardRow {
  id: number;
  oracle_id: string;
  name: string;
  slug: string;
  mana_value: number;
  type_line: string;
  color_identity: number;
  images: unknown;
  game_changer: boolean;
  released_at: string | null;
  reference_price_usd: number | null;
  reference_price_finish: string | null;
  prices_as_of: string | null;
  legal_commander: string;
  can_be_commander: boolean;
  partner_kind: string | null;
  partner_qualifier: string | null;
  copy_limit: number | null;
  is_basic_land: boolean;
  /**
   * Artist of the printing the images come from. Deliberately not in CardSummary: the contract is frozen,
   * and only Server Components need it, to credit art shown as a page backdrop.
   */
  artist: string | null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const toFinish = (finish: string | null): Finish => (finish === "foil" || finish === "etched" ? finish : "nonfoil");

export function toCardSummary(row: CardRow, today = todayIso()): CardSummary {
  return {
    id: row.id as CardId,
    oracleId: row.oracle_id as OracleId,
    name: row.name,
    slug: row.slug,
    manaValue: row.mana_value,
    typeLine: row.type_line,
    colorIdentity: maskToIdentity(row.color_identity),
    images: row.images as CardImages | null,
    gameChanger: row.game_changer,
    released: row.released_at === null || row.released_at <= today,
    price:
      row.reference_price_usd !== null && row.prices_as_of !== null
        ? { usd: Number(row.reference_price_usd), finish: toFinish(row.reference_price_finish), asOf: row.prices_as_of, source: "scryfall" }
        : null,
  };
}

export function toCommanderFacts(row: CardRow): CommanderCardFacts {
  return {
    id: row.id as CardId,
    name: row.name,
    colorIdentityMask: row.color_identity,
    legalCommander: row.legal_commander as CommanderCardFacts["legalCommander"],
    canBeCommander: row.can_be_commander,
    partnerKind: row.partner_kind,
    partnerQualifier: row.partner_qualifier,
    copyLimit: row.copy_limit,
    gameChanger: row.game_changer,
  };
}

const PRICE_CHECK_TTL_MS = 10 * 60 * 1000;
let priceCheck: { at: string | null; loadedAt: number } | null = null;

/**
 * When prices were last checked against Scryfall (prices_checked_at()). A card's prices_as_of only moves when its price
 * changes, so this is the as-of date to show. Cached briefly per server instance; null when it can't be read.
 */
async function pricesCheckedAt(db: PublicClient): Promise<string | null> {
  if (priceCheck && Date.now() - priceCheck.loadedAt < PRICE_CHECK_TTL_MS) return priceCheck.at;
  const { data, error } = await db.rpc("prices_checked_at");
  if (error) return priceCheck?.at ?? null;
  priceCheck = { at: data ?? null, loadedAt: Date.now() };
  return priceCheck.at;
}

/** A price is as current as the newest price check, even when it hasn't moved since. */
function withPriceCheck(row: CardRow, checkedAt: string | null): CardRow {
  if (!checkedAt || !row.prices_as_of || Date.parse(checkedAt) <= Date.parse(row.prices_as_of)) return row;
  return { ...row, prices_as_of: checkedAt };
}

export async function fetchCardsById(db: PublicClient, ids: readonly number[]): Promise<Map<number, CardRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const [{ data, error }, checkedAt] = await Promise.all([
    db.from("cards").select(CARD_COLUMNS).in("id", unique).is("deleted_at", null),
    pricesCheckedAt(db),
  ]);
  if (error) throw new Error(`Loading cards failed: ${error.message}`);
  return new Map((data as CardRow[]).map((row) => [row.id, withPriceCheck(row, checkedAt)]));
}
