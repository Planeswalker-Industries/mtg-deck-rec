import { describe, expect, it } from 'vitest';
import { edhrecCommanderPage } from './edhrec';

const view = (id: string, name: string, numDecks: number, potentialDecks: number, synergy: unknown = 0.1) => ({
  id,
  name,
  num_decks: numDecks,
  potential_decks: potentialDecks,
  synergy,
  trend_zscore: 0.5,
});

const page = (card: Record<string, unknown>, cardlists: unknown[]) => ({ creature: 30, container: { json_dict: { card, cardlists } } });

describe('edhrecCommanderPage', () => {
  it('reads the commander and one row per card, however many lists it is in', () => {
    const parsed = edhrecCommanderPage(
      page({ name: 'Liesa, Forgotten Archangel', names: ['Liesa, Forgotten Archangel'], id: 'liesa-print', num_decks: 3556, salt: 0.5, rank: 767 }, [
        { header: 'Top Cards', cardviews: [view('a', 'Sol Ring', 3400, 3556, 0.01)] },
        { header: 'Mana Artifacts', cardviews: [view('a', 'Sol Ring', 3400, 3556, 0.01), view('b', 'Arcane Signet', 3000, 3556)] },
        { header: 'New Cards', cardviews: [view('c', 'Brand New Angel', 3, 108, 0.02)] },
      ]),
    );
    expect(parsed).toEqual({
      names: ['Liesa, Forgotten Archangel'],
      printingId: 'liesa-print',
      deckCount: 3556,
      cards: [
        { printingId: 'a', name: 'Sol Ring', decksWith: 3400, potentialDecks: 3556, synergy: 0.01 },
        { printingId: 'b', name: 'Arcane Signet', decksWith: 3000, potentialDecks: 3556, synergy: 0.1 },
        { printingId: 'c', name: 'Brand New Angel', decksWith: 3, potentialDecks: 108, synergy: 0.02 },
      ],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/salt|rank/);
  });

  it('keeps both names of a partner pair or a double-faced card', () => {
    const parsed = edhrecCommanderPage(page({ name: 'Abby // Ellie', names: ['Abby, Merciless Soldier', 'Ellie, Brick Master'], num_decks: 114 }, []));
    expect(parsed?.names).toEqual(['Abby, Merciless Soldier', 'Ellie, Brick Master']);
    expect(parsed?.printingId).toBeNull();
    expect(parsed?.cards).toEqual([]);
  });

  it('falls back to the page name when names is missing', () => {
    expect(edhrecCommanderPage(page({ name: 'Aang, Air Nomad', num_decks: 55 }, []))?.names).toEqual(['Aang, Air Nomad']);
  });

  it('skips card views it cannot trust and clamps decks to potential decks', () => {
    const parsed = edhrecCommanderPage(
      page({ name: 'X', num_decks: 10 }, [
        {
          cardviews: [
            view('a', 'No Potential', 1, 0),
            view('b', 'Negative', -1, 10),
            { id: 'c', name: 'Missing Counts' },
            view('d', 'Too Many', 12, 10, 'not a number'),
            'junk',
          ],
        },
        'not a list',
      ]),
    );
    expect(parsed?.cards).toEqual([{ printingId: 'd', name: 'Too Many', decksWith: 10, potentialDecks: 10, synergy: null }]);
  });

  it('rejects colour group index pages and other shapes', () => {
    expect(edhrecCommanderPage({ related_info: [], container: { json_dict: { cardlists: [] } } })).toBeNull();
    expect(edhrecCommanderPage(page({ name: 'No Count' }, []))).toBeNull();
    expect(edhrecCommanderPage(null)).toBeNull();
    expect(edhrecCommanderPage('<html>')).toBeNull();
  });
});
