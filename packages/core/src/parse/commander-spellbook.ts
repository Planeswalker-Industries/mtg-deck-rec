/**
 * Commander Spellbook's combo export (https://json.commanderspellbook.com/variants.json.gz, refreshed daily) reduced to
 * what the raw `spellbook` tables keep: which cards a combo needs, what it produces and its bracket tag, in Spellbook's
 * own terms. One "variant" is one exact set of cards; Spellbook's id for it is its card ids joined with dashes
 * (`2645-5640-7935`), and commanderspellbook.com/combo/<id>/ is its page.
 *
 * Values are kept as published. Interpreting a bracket tag or a result status is the collator's job, so a value
 * Spellbook adds later lands in raw instead of dropping combos. Only a combo missing something structural (its id, a
 * card's oracle id or name, a result's id) is refused.
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
 * What a combo produces ("Infinite colored mana", "Win the game"). Status as published: today `S` a standalone result,
 * `C` a result that matters in context, `H` a hidden step Spellbook uses to chain combos together ("Infinite creature
 * ETB") and does not show as a result.
 */
export interface SpellbookFeature {
  id: number;
  name: string;
  status: string;
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
  /** The named cards, one entry per card, ascending by oracle id. */
  cards: SpellbookComboCard[];
  /** Pieces described rather than named ("Legendary Elemental Creature"), which any card matching them fills. */
  templates: string[];
  features: SpellbookFeature[];
  /** As published; `SPELLBOOK_BRACKET_TAGS` lists the known ones. */
  bracketTag: string;
  /** Mana needed to run the loop once its pieces are in place, beyond casting them. */
  manaValueNeeded: number;
  /** Spellbook's count of EDHREC decks that contain the combo (its `popularity`). EDHREC's numbers are never displayed. */
  edhrecDeckCount: number | null;
  /** Spellbook's ids for the generic combos this variant is an instance of; variants of one combo share them. */
  comboIds: number[];
}

/** A published combo, or why the element isn't one: unpublished (any status but `OK`) or missing something it needs. */
export type SpellbookVariant = { ok: true; combo: SpellbookCombo } | { ok: false; reason: 'not_published' | 'malformed' };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** A Scryfall oracle id, lowercase as Spellbook and Scryfall write it, so text order is uuid order. */
const ORACLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MALFORMED: SpellbookVariant = { ok: false, reason: 'malformed' };

/**
 * One element of the export's `variants` array. A malformed card, result or template refuses the whole combo rather
 * than keep one that silently needs a card fewer.
 */
export function spellbookVariant(body: unknown): SpellbookVariant {
  if (!isObject(body)) return MALFORMED;
  if (body.status !== 'OK') return { ok: false, reason: 'not_published' };
  if (!isText(body.id) || !Array.isArray(body.uses) || !Array.isArray(body.produces) || !isText(body.bracketTag)) return MALFORMED;

  const cards = new Map<string, SpellbookComboCard>();
  for (const use of body.uses) {
    const card = isObject(use) && isObject(use.card) ? use.card : null;
    if (!card || typeof card.oracleId !== 'string' || !ORACLE_ID.test(card.oracleId) || !isText(card.name)) return MALFORMED;
    const mustBeCommander = use.mustBeCommander === true;
    const seen = cards.get(card.oracleId);
    cards.set(card.oracleId, { oracleId: card.oracleId, name: card.name, mustBeCommander: mustBeCommander || (seen?.mustBeCommander ?? false) });
  }
  if (cards.size === 0) return MALFORMED;

  const templates: string[] = [];
  for (const requirement of Array.isArray(body.requires) ? body.requires : []) {
    const template = isObject(requirement) && isObject(requirement.template) ? requirement.template : null;
    if (!template || !isText(template.name)) return MALFORMED;
    templates.push(template.name);
  }

  const features = new Map<number, SpellbookFeature>();
  for (const produced of body.produces) {
    const feature = isObject(produced) && isObject(produced.feature) ? produced.feature : null;
    if (!feature || !isCount(feature.id) || !isText(feature.name) || !isText(feature.status)) return MALFORMED;
    features.set(feature.id, { id: feature.id, name: feature.name, status: feature.status });
  }

  const comboIds = (Array.isArray(body.of) ? body.of : [])
    .map((combo) => (isObject(combo) && isCount(combo.id) ? combo.id : null))
    .filter((id): id is number => id !== null);

  return {
    ok: true,
    combo: {
      id: body.id,
      cards: [...cards.values()].sort((a, b) => (a.oracleId < b.oracleId ? -1 : 1)),
      templates,
      features: [...features.values()],
      bracketTag: body.bracketTag,
      manaValueNeeded: isCount(body.manaValueNeeded) ? body.manaValueNeeded : 0,
      edhrecDeckCount: isCount(body.popularity) ? body.popularity : null,
      comboIds: [...new Set(comboIds)].sort((a, b) => a - b),
    },
  };
}
