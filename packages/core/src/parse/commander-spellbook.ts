/**
 * Commander Spellbook's combo export (https://json.commanderspellbook.com/variants.json.gz, refreshed daily) reduced to
 * what the app keeps: which cards a combo needs, what it produces, and its bracket tag. One "variant" is one exact set
 * of cards; Spellbook's id for it is its card ids joined with dashes (`2645-5640-7935`), and
 * commanderspellbook.com/combo/<id>/ is its page.
 *
 * Deliberately left out: step-by-step descriptions and prerequisites (50 MB a day of prose a link covers), prices
 * (ours come from Scryfall), images, other formats' legality, and salt.
 */

/** Spellbook's bracket tags (its syntax guide, "Bracket Tags"), with the WotC bracket each is searchable as. */
export const SPELLBOOK_BRACKET_TAGS = {
  R: { name: 'Ruthless', bracket: 4 },
  S: { name: 'Spicy', bracket: 3 },
  P: { name: 'Powerful', bracket: 3 },
  O: { name: 'Oddball', bracket: 2 },
  C: { name: 'Core', bracket: 2 },
  E: { name: 'Exhibition', bracket: 1 },
  /** Not legal in Commander, usually because it contains a banned card. */
  B: { name: 'Banned', bracket: null },
} as const satisfies Record<string, { name: string; bracket: number | null }>;

export type SpellbookBracketTag = keyof typeof SPELLBOOK_BRACKET_TAGS;

/**
 * What a combo produces ("Infinite colored mana", "Win the game"). Status: `S` a standalone result, `C` a result that
 * matters in context, `H` a hidden step Spellbook uses to chain combos together ("Infinite creature ETB") and does not
 * show as a result.
 */
export interface SpellbookFeature {
  id: number;
  name: string;
  status: 'S' | 'C' | 'H';
}

export interface SpellbookComboCard {
  oracleId: string;
  name: string;
  /** The combo only works with this card as the commander. */
  mustBeCommander: boolean;
}

export interface SpellbookCombo {
  /** Spellbook's variant id. */
  id: string;
  /** The named cards, one entry per card. */
  cards: SpellbookComboCard[];
  /** Pieces described rather than named ("Legendary Elemental Creature"), which any card matching them fills. */
  templates: string[];
  features: SpellbookFeature[];
  bracketTag: SpellbookBracketTag;
  /** Mana needed to run the loop once its pieces are in place, beyond casting them. */
  manaValueNeeded: number;
  /** Spellbook's count of EDHREC decks that contain the combo. EDHREC's numbers are never displayed. */
  popularity: number | null;
  /** Spellbook's ids for the generic combos this variant is an instance of; variants of one combo share them. */
  comboIds: number[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isFeatureStatus = (value: unknown): value is SpellbookFeature['status'] => value === 'S' || value === 'C' || value === 'H';
const isBracketTag = (value: unknown): value is SpellbookBracketTag => typeof value === 'string' && Object.hasOwn(SPELLBOOK_BRACKET_TAGS, value);

/** A Scryfall oracle id, which is what our catalog's `cards.oracle_id` holds. */
const ORACLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One element of the export's `variants` array, or null when it isn't a published combo (status other than `OK`) or
 * lacks something the app needs. A malformed card, feature or template drops the whole combo rather than leaving a
 * combo that silently needs one card fewer.
 */
export function spellbookVariant(body: unknown): SpellbookCombo | null {
  if (!isObject(body) || typeof body.id !== 'string' || body.id.length === 0 || body.status !== 'OK') return null;
  if (!Array.isArray(body.uses) || !Array.isArray(body.produces) || !isBracketTag(body.bracketTag)) return null;

  const cards = new Map<string, SpellbookComboCard>();
  for (const use of body.uses) {
    const card = isObject(use) && isObject(use.card) ? use.card : null;
    if (!card || typeof card.oracleId !== 'string' || !ORACLE_ID.test(card.oracleId) || typeof card.name !== 'string') return null;
    const mustBeCommander = use.mustBeCommander === true;
    const seen = cards.get(card.oracleId);
    cards.set(card.oracleId, { oracleId: card.oracleId, name: card.name, mustBeCommander: mustBeCommander || (seen?.mustBeCommander ?? false) });
  }
  if (cards.size === 0) return null;

  const templates: string[] = [];
  for (const requirement of Array.isArray(body.requires) ? body.requires : []) {
    const template = isObject(requirement) && isObject(requirement.template) ? requirement.template : null;
    if (!template || typeof template.name !== 'string' || template.name.length === 0) return null;
    templates.push(template.name);
  }

  const features = new Map<number, SpellbookFeature>();
  for (const produced of body.produces) {
    const feature = isObject(produced) && isObject(produced.feature) ? produced.feature : null;
    if (!feature || !isCount(feature.id) || typeof feature.name !== 'string' || !isFeatureStatus(feature.status)) return null;
    features.set(feature.id, { id: feature.id, name: feature.name, status: feature.status });
  }

  const comboIds = (Array.isArray(body.of) ? body.of : [])
    .map((combo) => (isObject(combo) && isCount(combo.id) ? combo.id : null))
    .filter((id): id is number => id !== null);

  return {
    id: body.id,
    cards: [...cards.values()],
    templates,
    features: [...features.values()],
    bracketTag: body.bracketTag,
    manaValueNeeded: isCount(body.manaValueNeeded) ? body.manaValueNeeded : 0,
    popularity: isCount(body.popularity) ? body.popularity : null,
    comboIds: [...new Set(comboIds)].sort((a, b) => a - b),
  };
}
