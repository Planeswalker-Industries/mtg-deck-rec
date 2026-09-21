import { describe, expect, it } from 'vitest';
import type { CardSet } from '../contract';
import {
  collectionGroup,
  majorSetsNewestFirst,
  matchesColors,
  matchesSearch,
  matchesSet,
  type ColorFilter,
  type ManaColor,
} from './index';

const filter = (colors: ManaColor[], opts: Partial<Omit<ColorFilter, 'colors'>> = {}): ColorFilter => ({
  colors: new Set(colors),
  colorless: opts.colorless ?? false,
  multicolor: opts.multicolor ?? false,
});

describe('collectionGroup', () => {
  it('files legendary creatures apart from other creatures', () => {
    expect(collectionGroup('Legendary Creature — Angel')).toBe('legendary_creature');
    expect(collectionGroup('Creature — Human Wizard')).toBe('creature');
    expect(collectionGroup('Legendary Artifact Creature — Golem')).toBe('legendary_creature');
  });
  it('follows the deck tool for everything else', () => {
    expect(collectionGroup('Legendary Planeswalker — Jace')).toBe('planeswalker');
    expect(collectionGroup('Legendary Land')).toBe('land');
    expect(collectionGroup('Legendary Enchantment')).toBe('enchantment');
    expect(collectionGroup('Instant')).toBe('instant');
  });
  it('reads only the front face', () => {
    expect(collectionGroup('Sorcery // Land')).toBe('sorcery');
  });
});

describe('matchesColors', () => {
  it('passes everything when nothing is toggled', () => {
    for (const identity of ['', 'W', 'RW', 'WUBRG']) expect(matchesColors(identity, filter([]))).toBe(true);
  });

  it('without multicolor, keeps cards whose colours are all toggled', () => {
    const rw = filter(['R', 'W']);
    expect(matchesColors('R', rw)).toBe(true);
    expect(matchesColors('W', rw)).toBe(true);
    expect(matchesColors('WR', rw)).toBe(true);
    expect(matchesColors('BR', rw)).toBe(false);
    expect(matchesColors('WBR', rw)).toBe(false);
    expect(matchesColors('', rw)).toBe(false);
  });

  it('colorless adds the cards with no colours', () => {
    expect(matchesColors('', filter([], { colorless: true }))).toBe(true);
    expect(matchesColors('R', filter([], { colorless: true }))).toBe(false);
    expect(matchesColors('', filter(['R'], { colorless: true }))).toBe(true);
    expect(matchesColors('R', filter(['R'], { colorless: true }))).toBe(true);
  });

  it('with multicolor, needs every toggled colour and at least two', () => {
    const mrwb = filter(['R', 'W', 'B'], { multicolor: true });
    expect(matchesColors('WBR', mrwb)).toBe(true);
    expect(matchesColors('WUBR', mrwb)).toBe(true);
    expect(matchesColors('WR', mrwb)).toBe(false);
    expect(matchesColors('WB', mrwb)).toBe(false);
    expect(matchesColors('R', mrwb)).toBe(false);
  });

  it('multicolor alone shows every multicolour card and nothing mono', () => {
    const m = filter([], { multicolor: true });
    expect(matchesColors('UG', m)).toBe(true);
    expect(matchesColors('G', m)).toBe(false);
    expect(matchesColors('', m)).toBe(false);
  });

  it('multicolor with a single colour keeps multicolour cards containing it', () => {
    const mr = filter(['R'], { multicolor: true });
    expect(matchesColors('BR', mr)).toBe(true);
    expect(matchesColors('R', mr)).toBe(false);
    expect(matchesColors('UG', mr)).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('matches the name or a tag, case-insensitively', () => {
    expect(matchesSearch('Sol Ring', ['mana rock'], 'sol')).toBe(true);
    expect(matchesSearch('Sol Ring', ['mana rock'], 'ROCK')).toBe(true);
    expect(matchesSearch('Sol Ring', ['mana rock'], 'removal')).toBe(false);
  });
  it('needs every word, each in the name or any tag', () => {
    expect(matchesSearch('Swords to Plowshares', ['removal', 'exile'], 'swords exile')).toBe(true);
    expect(matchesSearch('Swords to Plowshares', ['removal', 'exile'], 'swords draw')).toBe(false);
  });
  it('treats an empty query as no filter', () => {
    expect(matchesSearch('Anything', [], '   ')).toBe(true);
  });
});

describe('matchesSet', () => {
  const major = new Set(['MH3', 'C21']);
  it('passes everything for all sets', () => {
    expect(matchesSet([], { kind: 'all' }, major)).toBe(true);
  });
  it('matches any owned printing in the chosen set', () => {
    expect(matchesSet(['C21', 'SLD'], { kind: 'set', code: 'C21' }, major)).toBe(true);
    expect(matchesSet(['SLD'], { kind: 'set', code: 'C21' }, major)).toBe(false);
  });
  it('other means a printing outside the major sets', () => {
    expect(matchesSet(['SLD'], { kind: 'other' }, major)).toBe(true);
    expect(matchesSet(['MH3'], { kind: 'other' }, major)).toBe(false);
  });
  it('a card matched by name alone only passes all sets', () => {
    expect(matchesSet([], { kind: 'set', code: 'MH3' }, major)).toBe(false);
    expect(matchesSet([], { kind: 'other' }, major)).toBe(false);
  });
});

describe('majorSetsNewestFirst', () => {
  it('keeps major set types, newest first', () => {
    const sets: CardSet[] = [
      { code: 'SLD', name: 'Secret Lair Drop', setType: 'box', releasedAt: '2026-01-01' },
      { code: 'C21', name: 'Commander 2021', setType: 'commander', releasedAt: '2021-04-23' },
      { code: 'MH3', name: 'Modern Horizons 3', setType: 'draft_innovation', releasedAt: '2024-06-14' },
    ];
    expect(majorSetsNewestFirst(sets).map((s) => s.code)).toEqual(['MH3', 'C21']);
  });
});
