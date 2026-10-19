import type { CardFace, CardId, CardRules } from "@mtg/core/contract";
import type { PublicClient } from "./supabase";

/** A slim card_faces entry as sync:catalog writes it; faces from before the stats were stored lack them. */
type FaceRow = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The catalog's card_faces as contract faces, with each face's printed stats. Null for a single-faced card. */
export function toFaces(value: unknown): CardFace[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return value.map((face: FaceRow) => ({
    name: text(face.name) ?? "",
    manaCost: text(face.mana_cost) ?? "",
    typeLine: text(face.type_line) ?? "",
    oracleText: text(face.oracle_text) ?? "",
    power: text(face.power),
    toughness: text(face.toughness),
    loyalty: text(face.loyalty),
    defense: text(face.defense),
  }));
}

/**
 * Rules text and printed stats for the cards on screen, in one query. Read from Postgres rather than the search index:
 * the index carries what search and ranking need, and rules text for a handful of cards is a cheap primary-key read.
 */
export async function fetchCardRules(db: PublicClient, cardIds: readonly number[]): Promise<CardRules[]> {
  const unique = [...new Set(cardIds)];
  if (unique.length === 0) return [];
  const { data, error } = await db
    .from("cards")
    .select("id, oracle_text, power, toughness, loyalty, defense, card_faces")
    .in("id", unique)
    .is("deleted_at", null);
  if (error) throw new Error(`Loading card rules failed: ${error.message}`);
  return data.map((row) => ({
    cardId: row.id as CardId,
    oracleText: row.oracle_text,
    power: row.power,
    toughness: row.toughness,
    loyalty: row.loyalty,
    defense: row.defense,
    faces: toFaces(row.card_faces),
  }));
}
