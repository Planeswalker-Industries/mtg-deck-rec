// packages/core/src/journey/land-search.test.ts
import { describe, expect, it } from 'vitest';
import { landSearch } from './land-search';

const ALL = ['W', 'U', 'B', 'R', 'G', 'C'];

describe('landSearch', () => {
  it.each([
    ['Polluted Delta', '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.', ['U', 'B'], false],
    ['Evolving Wilds', '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', ALL, true],
    ['Fabled Passage', '{T}, Sacrifice Fabled Passage: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.', ALL, true],
    ['Prismatic Vista', '{T}, Pay 1 life, Sacrifice Prismatic Vista: Search your library for a basic land card, put it onto the battlefield, then shuffle.', ALL, true],
    ['Rampant Growth', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', ALL, true],
    ['Cultivate', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', ALL, true],
    ['Myriad Landscape', 'Myriad Landscape enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.', ALL, true],
    ['Bant Panorama', '{T}: Add {C}.\n{1}, {T}, Sacrifice Bant Panorama: Search your library for a basic Forest, Plains, or Island card, put it onto the battlefield tapped, then shuffle.', ['W', 'U', 'G'], true],
    ['Krosan Verge', 'Krosan Verge enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice Krosan Verge: Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle.', ['W', 'G'], false],
    ['Farseek', 'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.', ['W', 'U', 'B', 'R'], false],
    ["Nature's Lore", 'Search your library for a Forest card, put that card onto the battlefield, then shuffle.', ['G'], false],
    ['Wood Elves', 'When Wood Elves enters, search your library for a Forest card and put that card onto the battlefield. Then shuffle.', ['G'], false],
    ['Crop Rotation', 'As an additional cost to cast this spell, sacrifice a land.\nSearch your library for a land card, put that card onto the battlefield, then shuffle.', ALL, false],
  ])('%s', (_name, text, colours, basicOnly) => {
    expect(landSearch(text)).toEqual({ colours, basicOnly });
  });

  it.each([
    ['Expedition Map', '{2}, {T}, Sacrifice Expedition Map: Search your library for a land card, reveal it, put it into your hand, then shuffle.'],
    ['Demonic Tutor', 'Search your library for a card, put that card into your hand, then shuffle.'],
    ['Path to Exile', 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.'],
    ['Natural Order', 'As an additional cost to cast this spell, sacrifice a green creature.\nSearch your library for a green creature card, put it onto the battlefield, then shuffle.'],
    ['Sol Ring', '{T}: Add {C}{C}.'],
  ])('%s finds nothing', (_name, text) => {
    expect(landSearch(text)).toBeNull();
  });
});
