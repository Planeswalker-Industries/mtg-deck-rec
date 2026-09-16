import { createHash } from 'node:crypto';
import { normalizeName, slugify } from '@mtg/core/parse';

export interface ScryfallImageUris {
  small: string;
  normal: string;
  large: string;
  art_crop: string;
}

export interface ScryfallFace {
  name: string;
  oracle_id?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  color_indicator?: string[];
  flavor_name?: string;
  image_uris?: ScryfallImageUris;
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  layout: string;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors?: string[];
  color_indicator?: string[];
  color_identity: string[];
  legalities: Record<string, string>;
  games?: string[];
  released_at?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallFace[];
  prices: { usd: string | null; usd_foil: string | null; usd_etched: string | null };
  scryfall_uri: string;
  game_changer?: boolean;
  flavor_name?: string;
  artist?: string;
}

// A type alias, not an interface: postgres.js only accepts JSON-compatible values, and interfaces
// lack the implicit index signature that makes them assignable to its JSONValue type.
type CardImageSet = {
  small: string;
  normal: string;
  large: string;
  artCrop: string;
};

/** Row shape of the stg_cards staging table (mirrors public.cards without id/updated_at/deleted_at/equivalence_base_id). */
export interface CardRow {
  oracle_id: string;
  name: string;
  name_normalized: string;
  slug: string;
  layout: string;
  mana_value: number;
  type_line: string;
  oracle_text: string | null;
  card_faces: { name: string; mana_cost: string; type_line: string; oracle_text: string }[] | null;
  color_identity: number;
  is_basic_land: boolean;
  can_be_commander: boolean;
  partner_kind: string | null;
  partner_qualifier: string | null;
  copy_limit: number | null;
  legal_commander: string;
  legalities: Record<string, string>;
  game_changer: boolean;
  is_digital_only: boolean;
  released_at: string | null;
  images: { front: CardImageSet; back: CardImageSet | null } | null;
  /** Artist of the representative printing, so an art crop can carry its credit. */
  artist: string | null;
  scryfall_uri: string;
  reference_price_usd: string | null;
  reference_price_finish: 'nonfoil' | 'foil' | 'etched' | null;
  prices_as_of: string;
  content_hash: Buffer;
  rules_hash: Buffer;
}

export interface CardNameRow {
  oracle_id: string;
  name_normalized: string;
  kind: 'full' | 'face' | 'printed' | 'alchemy';
}

export const CARD_COLUMNS = [
  'oracle_id',
  'name',
  'name_normalized',
  'slug',
  'layout',
  'mana_value',
  'type_line',
  'oracle_text',
  'card_faces',
  'color_identity',
  'is_basic_land',
  'can_be_commander',
  'partner_kind',
  'partner_qualifier',
  'copy_limit',
  'legal_commander',
  'legalities',
  'game_changer',
  'is_digital_only',
  'released_at',
  'images',
  'artist',
  'scryfall_uri',
  'reference_price_usd',
  'reference_price_finish',
  'prices_as_of',
  'content_hash',
  'rules_hash',
] as const satisfies readonly (keyof CardRow)[];

/** Layouts that are not cards you put in a deck. */
export const NON_DECK_LAYOUTS: ReadonlySet<string> = new Set([
  'token',
  'double_faced_token',
  'emblem',
  'art_series',
  'planar',
  'scheme',
  'vanguard',
]);

/**
 * Jumpstart and Commander theme cards (type line "Card", text like "(Theme color: {W})") come with normal layouts
 * but aren't playable. Left in, dozens of them group as rules-identical "twins".
 */
export function isThemeCard(typeLine: string | undefined): boolean {
  return typeLine === 'Card';
}

const COLOR_BITS: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const toImageSet = (u: ScryfallImageUris | undefined): CardImageSet | null =>
  u ? { small: u.small, normal: u.normal, large: u.large, artCrop: u.art_crop } : null;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces a card's own names in its rules text with CARDNAME, so renamed twins produce identical text.
 * Covers the full name, each face name, and the short name legendary cards use in their text ("Rick" for
 * "Rick, Steadfast Leader"). Matches whole words only, so a short name inside another word is left alone.
 */
export function maskOwnNames(text: string, names: readonly string[]): string {
  const variants = new Set<string>();
  for (const name of names) {
    variants.add(name);
    const short = name.split(',')[0]?.trim();
    if (short && short !== name && short.length >= 3) variants.add(short);
  }
  let masked = text;
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(variant)}(?![\\p{L}\\p{N}])`, 'gu'), 'CARDNAME');
  }
  return masked;
}

/** Identifies rules-identical cards regardless of name: cost, type line, masked text, stats and colors, per face. */
function rulesHashOf(card: ScryfallCard, faces: readonly ScryfallFace[], typeLine: string, text: string): Buffer {
  const names = [card.name, ...faces.map((f) => f.name)];
  const faceRules =
    faces.length > 1
      ? faces.map((f) => [
          f.mana_cost ?? '',
          f.type_line ?? '',
          maskOwnNames(f.oracle_text ?? '', names),
          f.power ?? null,
          f.toughness ?? null,
          f.loyalty ?? null,
          f.defense ?? null,
          f.color_indicator ?? null,
        ])
      : null;
  return createHash('sha1')
    .update(
      JSON.stringify([
        card.mana_cost ?? null,
        card.cmc ?? 0,
        typeLine,
        maskOwnNames(text, names),
        card.power ?? null,
        card.toughness ?? null,
        card.loyalty ?? null,
        card.defense ?? null,
        card.colors ?? null,
        card.color_indicator ?? null,
        card.color_identity,
        faceRules,
      ]),
    )
    .digest();
}

function partnerOf(text: string, frontType: string): { kind: string | null; qualifier: string | null } {
  const partnerWith = /Partner with ([^(\n]+?)(?:\s*\(|$)/m.exec(text);
  if (partnerWith?.[1]) return { kind: 'partner_with', qualifier: partnerWith[1].trim() };
  const qualified = /\bPartner—([^(\n]+?)(?:\s*\(|$)/m.exec(text);
  if (qualified?.[1]) return { kind: 'partner_qualified', qualifier: qualified[1].trim() };
  if (/^Partner(?:\s*\(|\s*$)/m.test(text)) return { kind: 'partner', qualifier: null };
  if (/^Friends forever/m.test(text)) return { kind: 'friends_forever', qualifier: null };
  if (/Choose a Background/.test(text)) return { kind: 'choose_background', qualifier: null };
  if (/Doctor's companion/.test(text)) return { kind: 'doctors_companion', qualifier: null };
  if (/\bBackground\b/.test(frontType)) return { kind: 'background', qualifier: null };
  if (/\bTime Lord Doctor\b/.test(frontType)) return { kind: 'doctor', qualifier: null };
  return { kind: null, qualifier: null };
}

function copyLimitOf(text: string, isBasicLand: boolean): number | null {
  if (isBasicLand || /A deck can have any number of cards named/.test(text)) return 0;
  const upTo = /A deck can have up to (\w+) cards named/.exec(text);
  return upTo?.[1] ? (NUMBER_WORDS[upTo[1].toLowerCase()] ?? null) : null;
}

/**
 * Maps one Oracle Cards bulk entry to a catalog row plus its name aliases.
 * Returns null for things that aren't deck cards (tokens, art cards, planes…).
 * Prices here come from Scryfall's representative printing; sync:printings replaces them with the cheapest printing.
 * Flavor-name aliases come from sync:printings too, since flavor names live on individual printings.
 */
export function toCardRows(card: ScryfallCard, pricesAsOf: string): { card: CardRow; names: CardNameRow[] } | null {
  if (NON_DECK_LAYOUTS.has(card.layout)) return null;
  const faces = card.card_faces ?? [];
  const oracleId = card.oracle_id ?? faces[0]?.oracle_id;
  if (!oracleId) return null;

  const typeLine = card.type_line ?? faces.map((f) => f.type_line ?? '').join(' // ');
  if (isThemeCard(typeLine)) return null;
  const frontType = faces[0]?.type_line ?? typeLine;
  const text = card.oracle_text ?? faces.map((f) => f.oracle_text ?? '').join('\n');
  const isBasicLand = /\bBasic\b/.test(frontType) && /\bLand\b/.test(frontType);
  const partner = partnerOf(text, frontType);
  const canBeCommander =
    (/\bLegendary\b/.test(frontType) && /\bCreature\b/.test(frontType)) ||
    /can be your commander/i.test(text) ||
    partner.kind === 'background';

  const front = toImageSet(card.image_uris ?? faces[0]?.image_uris);
  const back = card.image_uris ? null : toImageSet(faces[1]?.image_uris);
  const images = front ? { front, back } : null;

  const priced = (
    [
      ['nonfoil', card.prices.usd],
      ['foil', card.prices.usd_foil],
      ['etched', card.prices.usd_etched],
    ] as const
  ).find(([, value]) => value !== null);

  const slimFaces =
    faces.length > 1
      ? faces.map((f) => ({ name: f.name, mana_cost: f.mana_cost ?? '', type_line: f.type_line ?? '', oracle_text: f.oracle_text ?? '' }))
      : null;
  const colorIdentity = card.color_identity.reduce((bits, c) => bits | (COLOR_BITS[c] ?? 0), 0);
  const gameChanger = card.game_changer === true;
  const legalities = card.legalities;

  // Prices are excluded so a price-only change doesn't count as a card change.
  const contentHash = createHash('sha1')
    .update(
      JSON.stringify([
        card.name,
        card.layout,
        card.cmc,
        typeLine,
        text,
        slimFaces,
        colorIdentity,
        legalities,
        gameChanger,
        images,
        card.released_at,
        card.artist ?? null,
      ]),
    )
    .digest();

  const row: CardRow = {
    oracle_id: oracleId,
    name: card.name,
    name_normalized: normalizeName(card.name),
    slug: slugify(card.name),
    layout: card.layout,
    mana_value: card.cmc ?? 0,
    type_line: typeLine,
    oracle_text: text || null,
    card_faces: slimFaces,
    color_identity: colorIdentity,
    is_basic_land: isBasicLand,
    can_be_commander: canBeCommander,
    partner_kind: partner.kind,
    partner_qualifier: partner.qualifier,
    copy_limit: copyLimitOf(text, isBasicLand),
    legal_commander: legalities.commander ?? 'not_legal',
    legalities,
    game_changer: gameChanger,
    is_digital_only: !(card.games ?? []).includes('paper'),
    released_at: card.released_at ?? null,
    images,
    artist: card.artist ?? null,
    scryfall_uri: card.scryfall_uri,
    reference_price_usd: priced ? priced[1] : null,
    reference_price_finish: priced ? priced[0] : null,
    prices_as_of: pricesAsOf,
    content_hash: contentHash,
    rules_hash: rulesHashOf(card, faces, typeLine, text),
  };

  const aliases = new Map<string, CardNameRow['kind']>();
  const add = (name: string | undefined, kind: CardNameRow['kind']) => {
    if (!name) return;
    const normalized = normalizeName(name);
    if (!aliases.has(normalized)) aliases.set(normalized, kind);
  };
  add(card.name, 'full');
  if (faces.length > 1) for (const f of faces) add(f.name, 'face');
  if (card.name.startsWith('A-')) add(card.name.slice(2), 'alchemy');

  return {
    card: row,
    names: [...aliases].map(([name_normalized, kind]) => ({ oracle_id: oracleId, name_normalized, kind })),
  };
}
