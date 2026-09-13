import type { CardSummary, TagRef } from '../cards';
import type { CardId, ColorIdentity, OracleId, TagId } from '../ids';

export const MOCK_AS_OF = '2026-09-13T00:00:00.000Z';

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const slugify = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

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

interface Seed {
  id: number;
  name: string;
  mv: number;
  type: string;
  ci: ColorIdentity;
  usd: number | null;
  gc?: boolean;
  tags: TagRef[];
}

const t = mockTags;
const seeds: Seed[] = [
  { id: 1, name: 'Chulane, Teller of Tales', mv: 5, type: 'Legendary Creature — Human Druid', ci: 'WUG', usd: 3.2, tags: [t.draw] },
  { id: 2, name: 'Sol Ring', mv: 1, type: 'Artifact', ci: '', usd: 1.5, tags: [t.manaRock] },
  { id: 3, name: 'Arcane Signet', mv: 2, type: 'Artifact', ci: '', usd: 0.9, tags: [t.manaRock] },
  { id: 4, name: 'Mind Stone', mv: 2, type: 'Artifact', ci: '', usd: 0.6, tags: [t.manaRock, t.draw] },
  { id: 5, name: 'Cultivate', mv: 3, type: 'Sorcery', ci: 'G', usd: 0.4, tags: [t.landRamp] },
  { id: 6, name: "Kodama's Reach", mv: 3, type: 'Sorcery — Arcane', ci: 'G', usd: 0.5, tags: [t.landRamp] },
  { id: 7, name: 'Farseek', mv: 2, type: 'Sorcery', ci: 'G', usd: 1.1, tags: [t.landRamp] },
  { id: 8, name: "Nature's Lore", mv: 2, type: 'Sorcery', ci: 'G', usd: 0.8, tags: [t.landRamp] },
  { id: 9, name: 'Swords to Plowshares', mv: 1, type: 'Instant', ci: 'W', usd: 1.9, tags: [t.spotRemoval] },
  { id: 10, name: 'Path to Exile', mv: 1, type: 'Instant', ci: 'W', usd: 2.4, tags: [t.spotRemoval] },
  { id: 11, name: 'Generous Gift', mv: 3, type: 'Instant', ci: 'W', usd: 1.0, tags: [t.spotRemoval] },
  { id: 12, name: 'Beast Within', mv: 3, type: 'Instant', ci: 'G', usd: 0.9, tags: [t.spotRemoval] },
  { id: 13, name: 'Counterspell', mv: 2, type: 'Instant', ci: 'U', usd: 1.2, tags: [t.counter] },
  { id: 14, name: 'Rhystic Study', mv: 3, type: 'Enchantment', ci: 'U', usd: 35, gc: true, tags: [t.draw] },
  { id: 15, name: 'Cyclonic Rift', mv: 2, type: 'Instant', ci: 'U', usd: 28, gc: true, tags: [t.bounce] },
  { id: 16, name: 'Birds of Paradise', mv: 1, type: 'Creature — Bird', ci: 'G', usd: 8.5, tags: [t.manaDork] },
  { id: 17, name: 'Llanowar Elves', mv: 1, type: 'Creature — Elf Druid', ci: 'G', usd: 0.3, tags: [t.manaDork] },
  { id: 18, name: 'Lightning Bolt', mv: 1, type: 'Instant', ci: 'R', usd: 1.0, tags: [t.spotRemoval] },
  { id: 19, name: 'Command Tower', mv: 0, type: 'Land', ci: '', usd: 0.3, tags: [] },
];

export const mockCards: CardSummary[] = seeds.map((s) => ({
  id: s.id as CardId,
  oracleId: uuid('00000000', s.id) as OracleId,
  name: s.name,
  slug: slugify(s.name),
  manaValue: s.mv,
  typeLine: s.type,
  colorIdentity: s.ci,
  imageUri: null,
  gameChanger: s.gc ?? false,
  released: true,
  price: s.usd === null ? null : { usd: s.usd, finish: 'nonfoil', asOf: MOCK_AS_OF, source: 'scryfall' },
}));

export const mockCardTags: Record<number, TagRef[]> = Object.fromEntries(seeds.map((s) => [s.id, s.tags]));

export const MOCK_COMMANDER_ID = 1 as CardId;

export const mockDecklistText = `Commander
1 Chulane, Teller of Tales

Deck
1 Sol Ring
1 Arcane Signet
1 Cultivate
1 Swords to Plowshares
1 Counterspell
1 Cyclonic Rift
1 Lightning Bolt
1 Llanowar Elves
1 Command Tower
`;
