import { describe, expect, it } from 'vitest';
import type { CardId, StatTargets } from '../contract';
import { buyLines, linesBoughtFor, openBuyLines } from './buy-for';
import { buildTally, type TallyCard, type TallyEntry } from './deck-tally';

const RAMP = 'ramp-role';

let nextId = 1;
const card = (over: Partial<TallyCard> = {}): TallyCard => ({
  id: nextId++ as CardId,
  typeLine: 'Creature — Merfolk',
  manaValue: 2,
  gameChanger: false,
  roles: [],
  ...over,
});
const island = card({ typeLine: 'Basic Land — Island', manaValue: 0, producedMana: 'U' });
const tower = card({ typeLine: 'Land', manaValue: 0, producedMana: 'U' });
const plainsOnly = card({ typeLine: 'Land', manaValue: 0, producedMana: 'W' });
const signet = card({ typeLine: 'Artifact', roles: [RAMP], producedMana: 'U' });
const commander = card({ typeLine: 'Legendary Creature — Merfolk', manaValue: 4, manaCost: '{2}{U}{U}', colorIdentity: 'U' });

const targets: StatTargets = {
  source: 'commander',
  label: 'Test decks (500)',
  lands: 36,
  basicLands: 20,
  roles: [{ roleId: RAMP, label: 'Ramp', target: 10 }],
  curve: [0, 8, 12, 10, 8, 6, 3, 2],
  types: [{ cardType: 'artifact', label: 'Artifacts', target: 8 }],
  colourSourceCap: null,
  bracketLimits: { massLandDenialFromBracket: 4, maxExtraTurnCards: {}, extraTurnLoopResults: [], extraTurnLoopFromBracket: 4 },
};

const copies = (of: TallyCard, quantity: number): TallyEntry[] =>
  Array.from({ length: quantity }, () => ({ card: { ...of, id: nextId++ as CardId }, quantity: 1 }));

describe('linesBoughtFor', () => {
  const every = buyLines([RAMP, 'artifact', 'curve', 'lands', 'basicLands', 'sources:U'], 'U');

  it('names the opened lines a card counts on', () => {
    expect(linesBoughtFor(signet, every)).toEqual([RAMP, 'artifact', 'curve', 'sources:U']);
    expect(linesBoughtFor(card(), every)).toEqual(['curve']);
  });

  it('counts a nonbasic land for lands, for basic lands (it takes one\'s place) and for the colour it makes', () => {
    expect(linesBoughtFor(tower, every)).toEqual(['lands', 'basicLands', 'sources:U']);
    expect(linesBoughtFor(plainsOnly, every)).toEqual(['lands', 'basicLands']);
    expect(linesBoughtFor(island, every)).toEqual(['lands', 'sources:U']);
  });

  it('names none without opened lines', () => {
    expect(buyLines([], 'U')).toBeNull();
    expect(buyLines(undefined, 'U')).toBeNull();
    expect(linesBoughtFor(signet, null)).toEqual([]);
  });
});

describe('openBuyLines', () => {
  const buyFor = [RAMP, 'artifact', 'curve', 'basicLands', 'sources:U'];

  it('keeps a line open while it is short of its target, and closes it there', () => {
    // Nine Signets: one short of the ramp target, past the artifact target.
    const short = buildTally([...copies(signet, 9), ...copies(island, 20)], [commander]);
    expect(openBuyLines(buyFor, 'U', short, targets)?.keys).toEqual([RAMP, 'curve']);
    const full = buildTally([...copies(signet, 10), ...copies(island, 20)], [commander]);
    expect(openBuyLines([RAMP], 'U', full, targets)).toBeNull();
  });

  it('opens the curve bar by bar', () => {
    // Twelve two-drops: that bar is at its target, the others are short.
    const tally = buildTally(copies(card(), 12), [commander]);
    const lines = openBuyLines(['curve'], 'U', tally, targets);
    expect(linesBoughtFor(card({ manaValue: 2 }), lines)).toEqual([]);
    expect(linesBoughtFor(card({ manaValue: 3 }), lines)).toEqual(['curve']);
  });

  it('opens basic lands while there are too many, and a colour while it is short of sources', () => {
    const tally = buildTally([...copies(island, 2), ...copies(plainsOnly, 30)], [commander]);
    expect(openBuyLines(['basicLands', 'sources:U'], 'U', tally, targets)?.keys).toEqual(['sources:U']);
    const basics = buildTally(copies(island, 30), [commander]);
    expect(openBuyLines(['basicLands', 'sources:U'], 'U', basics, targets)?.keys).toEqual(['basicLands']);
  });
});
