import { describe, expect, it } from 'vitest';
import type { AddSuggestion, CardId, CardSummary, CutSuggestion, OracleId, ScoreBreakdown } from '../contract';
import { buyLines } from '../journey/buy-for';
import { fixPool, type FixPoolInput } from './fix-pool';
import type { RankCard } from './rank';

const RAMP = 'ramp-role';

const summary = (id: number, name: string, typeLine: string, over: Partial<CardSummary> = {}): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as OracleId,
  name,
  slug: name.toLowerCase().replace(/\W+/g, '-'),
  manaValue: 2,
  manaCost: '{1}{G}',
  typeLine,
  colorIdentity: 'G',
  images: null,
  gameChanger: false,
  released: true,
  keywords: [],
  price: null,
  ...over,
});

const score = (total: number): ScoreBreakdown => ({
  total,
  components: { tag: null, manaValue: null, staple: null, corpus: total, votes: null, role: null, curve: null, deck: null, mana: null },
  effectiveWeights: { tag: 0, manaValue: 0, staple: 0, corpus: 1, votes: 0, role: 0, curve: 0, deck: 0, mana: 0 },
});

const add = (card: CardSummary, total: number, over: Partial<AddSuggestion> = {}): AddSuggestion => ({
  card,
  category: 'creature',
  score: score(total),
  corpus: null,
  fillsRoles: [],
  owned: { quantity: 1 },
  ...over,
});

const rank = (card: CardSummary): RankCard => ({ summary: card, colorIdentity: 16, legal: true, isBasicLand: card.typeLine.startsWith('Basic') });
const cut = (card: CardSummary, cutScore: number): CutSuggestion => ({ card, cutScore, reasons: ['LOW_SYNERGY'], severity: 'suggested', corpus: null, owned: null });

const creatures = Array.from({ length: 5 }, (_, i) => add(summary(10 + i, `Creature ${i}`, 'Creature — Elf'), 0.9 - i * 0.01));
const rocks = Array.from({ length: 5 }, (_, i) => add(summary(20 + i, `Rock ${i}`, 'Artifact', { producedMana: 'G' }), 0.5 - i * 0.01));
const rampRoles = new Map(rocks.map((r) => [r.card.id as number, [RAMP]]));
const forest = rank(summary(90, 'Forest', 'Basic Land — Forest', { manaValue: 0, manaCost: '', producedMana: 'G' }));

const input = (over: Partial<FixPoolInput> = {}): FixPoolInput => ({
  adds: [...rocks, ...creatures],
  rolesOf: (a) => rampRoles.get(a.card.id) ?? [],
  basics: [{ card: forest, owned: null }],
  deck: [],
  cuts: [],
  playScore: () => null,
  roleIds: [RAMP],
  deckColours: 'G',
  buyLines: null,
  only: false,
  perLine: 2,
  ...over,
});

const names = (cards: readonly { card: CardSummary }[]) => cards.map((c) => c.card.name);

describe('fixPool in cards', () => {
  it("keeps each line's best and the best overall, best first, and always the basic lands", () => {
    const pool = fixPool(input());
    // Creatures 0 and 1 are the best of their type and of the two-drops; Rocks 0 and 1 the best ramp, artifacts and sources.
    expect(names(pool.ins)).toEqual(['Creature 0', 'Creature 1', 'Rock 0', 'Rock 1', 'Forest']);
    expect(pool.ins.find((c) => c.card.name === 'Rock 0')).toMatchObject({ roles: [RAMP], score: 0.5, card: { roles: [RAMP] } });
    expect(pool.ins.at(-1)).toMatchObject({ score: 0, owned: null });
  });

  it('leaves out a card that would complete a combo above the bracket', () => {
    const over = { ...creatures[0]!, completesOverBracket: [{ id: 'c', url: 'u', results: ['Win the game'], minBracket: 4 as const }] };
    const pool = fixPool(input({ adds: [over, ...creatures.slice(1)] }));
    expect(names(pool.ins)).toEqual(['Creature 1', 'Creature 2', 'Forest']);
  });

  it("marks an unowned card with the opened lines it helps, counted apart from the collection's", () => {
    const unowned = [
      add(summary(30, 'Bought Rock', 'Artifact', { producedMana: 'G' }), 0.99, { owned: null }),
      add(summary(31, 'Bought Creature', 'Creature — Elf'), 0.98, { owned: null }),
    ];
    const pool = fixPool(
      input({
        adds: [...unowned, ...rocks, ...creatures],
        rolesOf: (a) => (a.card.id === 30 ? [RAMP] : (rampRoles.get(a.card.id) ?? [])),
        buyLines: buyLines([RAMP], 'G'),
        only: true,
      }),
    );
    // The creature helps no opened line; the rock is one more card, not one of ramp's two.
    expect(names(pool.ins)).toEqual(['Bought Rock', 'Creature 0', 'Creature 1', 'Rock 0', 'Rock 1', 'Forest']);
    expect(pool.ins[0]?.buyFor).toEqual([RAMP]);
    expect(pool.ins.slice(1).every((c) => c.buyFor === undefined)).toBe(true);
  });

  it("treats an unowned card like any other outside 'only' mode", () => {
    const pool = fixPool(input({ adds: [add(summary(31, 'Unowned', 'Creature — Elf'), 0.98, { owned: null }), ...creatures] }));
    expect(pool.ins[0]).toMatchObject({ card: { name: 'Unowned' }, owned: null });
    expect(pool.ins[0]?.buyFor).toBeUndefined();
  });
});

describe('fixPool deck cards', () => {
  it('scores a card by its cut score, and a card with no reason to cut above every one that has', () => {
    const weak = summary(1, 'Weak', 'Creature — Elf');
    const weaker = summary(2, 'Weaker', 'Creature — Elf');
    const loved = summary(3, 'Loved', 'Creature — Elf');
    const liked = summary(4, 'Liked', 'Creature — Elf');
    const play = new Map([
      [3, 0.9],
      [4, 0.6],
    ]);
    const pool = fixPool(
      input({
        deck: [weak, weaker, loved, liked, forest.summary].map((c) => ({ card: rank(c), roles: c.id === 1 ? [RAMP] : [], owned: null })),
        cuts: [cut(weaker, 0.6), cut(weak, 0.4)],
        playScore: (id) => play.get(id) ?? null,
      }),
    );
    const scores = new Map(pool.deck.map((c) => [c.card.name, c.score]));
    expect(scores.get('Weaker')).toBe(0.4);
    expect(scores.get('Weak')).toBe(0.6);
    // The weakest cut scores 0.4: the rest take a share of it by how little the commander's decks play them.
    expect(scores.get('Liked')).toBe(0.84);
    expect(scores.get('Loved')).toBe(0.96);
    // The commander's decks can't judge a basic land: it fits best.
    expect(scores.get('Forest')).toBe(1);
    expect(pool.deck.find((c) => c.card.name === 'Weak')).toMatchObject({ roles: [RAMP], card: { roles: [RAMP] } });
  });
});
