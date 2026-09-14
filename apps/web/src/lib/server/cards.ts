import type { CommanderCardFacts } from "@mtg/core/commander";
import { maskToIdentity } from "@mtg/core/commander";
import type { CardId, CardImages, CardSummary, Finish, OracleId } from "@mtg/core/contract";
import type { PublicClient } from "./supabase";

/** Columns needed to build a CardSummary and run Commander rules. */
export const CARD_COLUMNS =
  "id, oracle_id, name, slug, mana_value, type_line, color_identity, images, game_changer, released_at, reference_price_usd, reference_price_finish, prices_as_of, legal_commander, can_be_commander, partner_kind, partner_qualifier, copy_limit, is_basic_land" as const;

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

export async function fetchCardsById(db: PublicClient, ids: readonly number[]): Promise<Map<number, CardRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("cards").select(CARD_COLUMNS).in("id", unique).is("deleted_at", null);
  if (error) throw new Error(`Loading cards failed: ${error.message}`);
  return new Map((data as CardRow[]).map((row) => [row.id, row]));
}
