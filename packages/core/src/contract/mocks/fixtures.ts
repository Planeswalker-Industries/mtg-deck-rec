import { slugify } from '../../parse/normalize';
import type { CardSummary, TagRef } from '../cards';
import type { CardId, Finish, OracleId, TagId } from '../ids';
import scryfall from './scryfall-cards.json';

export { slugify };

/** When the fixture prices were fetched from Scryfall. */
export const MOCK_AS_OF = scryfall.pricesAsOf;

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** "Sea Gate Restoration // Sea Gate, Reborn" → "Sea Gate Restoration" */
export const frontFaceName = (name: string) => name.split(' // ')[0] ?? name;

const tag = (n: number, slug: string, label: string): TagRef => ({ id: uuid('10000000', n) as TagId, slug, label });

export const mockTags = {
  ramp: tag(1, 'ramp', 'Ramp'),
  manaRock: tag(2, 'mana-rock', 'Mana rock'),
  landRamp: tag(3, 'ramp-land', 'Land ramp'),
  manaDork: tag(4, 'mana-dork', 'Mana dork'),
  removal: tag(5, 'removal', 'Removal'),
  spotRemoval: tag(6, 'removal-creature', 'Creature removal'),
  bounce: tag(7, 'bounce', 'Bounce'),
  counter: tag(8, 'counterspell', 'Counterspell'),
  draw: tag(9, 'card-advantage', 'Card advantage'),
} as const;

/** child tag id → parent tag */
export const mockTagParent: Record<string, TagRef> = {
  [mockTags.manaRock.id]: mockTags.ramp,
  [mockTags.landRamp.id]: mockTags.ramp,
  [mockTags.manaDork.id]: mockTags.ramp,
  [mockTags.spotRemoval.id]: mockTags.removal,
  [mockTags.bounce.id]: mockTags.removal,
};

const t = mockTags;
/** Hand-assigned stand-ins for Tagger data, keyed by card name. Command Tower is deliberately untagged. */
const TAGS_BY_NAME: Record<string, TagRef[]> = {
  'Chulane, Teller of Tales': [t.draw],
  'Sol Ring': [t.manaRock],
  'Arcane Signet': [t.manaRock],
  'Mind Stone': [t.manaRock, t.draw],
  'Fellwar Stone': [t.manaRock],
  'Talisman of Unity': [t.manaRock],
  Cultivate: [t.landRamp],
  "Kodama's Reach": [t.landRamp],
  Farseek: [t.landRamp],
  "Nature's Lore": [t.landRamp],
  'Three Visits': [t.landRamp],
  'Rampant Growth': [t.landRamp],
  'Growth Spiral': [t.landRamp, t.draw],
  'Birds of Paradise': [t.manaDork],
  'Llanowar Elves': [t.manaDork],
  'Elvish Mystic': [t.manaDork],
  'Swords to Plowshares': [t.spotRemoval],
  'Path to Exile': [t.spotRemoval],
  'Generous Gift': [t.spotRemoval],
  'Beast Within': [t.spotRemoval],
  'Lightning Bolt': [t.spotRemoval],
  Counterspell: [t.counter],
  'Arcane Denial': [t.counter],
  'Swan Song': [t.counter],
  'Rhystic Study': [t.draw],
  'Guardian Project': [t.draw],
  'Beast Whisperer': [t.draw],
  'Fact or Fiction': [t.draw],
  'Sea Gate Restoration // Sea Gate, Reborn': [t.draw],
  'Cyclonic Rift': [t.bounce],
  'Command Tower': [],
};

const toFinish = (finish: string): Finish => (finish === 'foil' || finish === 'etched' ? finish : 'nonfoil');

/** Real Scryfall data (names, images, prices, Game Changer flags) for a small card pool. */
export const mockCards: CardSummary[] = scryfall.cards.map((c, i) => ({
  id: (i + 1) as CardId,
  oracleId: c.oracleId as OracleId,
  name: c.name,
  slug: slugify(c.name),
  manaValue: c.manaValue,
  typeLine: c.typeLine,
  colorIdentity: c.colorIdentity,
  images: c.images,
  gameChanger: c.gameChanger,
  released: true,
  price: c.price ? { usd: c.price.usd, finish: toFinish(c.price.finish), asOf: MOCK_AS_OF, source: 'scryfall' } : null,
}));

export const mockCardTags: Record<number, TagRef[]> = Object.fromEntries(
  mockCards.map((c) => [c.id, TAGS_BY_NAME[c.name] ?? []]),
);

export const MOCK_COMMANDER_ID = 1 as CardId;

export const mockDecklistText = `Commander
1 Chulane, Teller of Tales

Deck
1 Sol Ring
1 Arcane Signet
1 Mind Stone
1 Cultivate
1 Kodama's Reach
1 Birds of Paradise
1 Llanowar Elves
1 Swords to Plowshares
1 Beast Within
1 Counterspell
1 Cyclonic Rift
1 Rhystic Study
1 Fact or Fiction
1 Sea Gate Restoration
1 Lightning Bolt
1 Command Tower
`;
