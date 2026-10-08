import { describe, expect, it } from 'vitest';
import { TEST_SCORING } from './test-config';
import { corpusComponent, pickCorpusSources, shrunkInclusion, type CorpusKey } from './corpus';
import {
  addPoolScore,
  cardPrior,
  commanderCardCounts,
  derivedPairRowSums,
  identityBaselineDecks,
  identityPoolDecks,
  isDerivedPair,
  keyRowSums,
  partnerRowSums,
  servedCardRates,
  servedCorpusScore,
  type KeyCardCount,
} from './serving';

const settings = { shrinkAlpha: 20, minDecks: 50, fullDecks: 100, partnerPoolWeight: 0.25, edhrecPriorCap: 0 };
const W = 1;
const U = 2;
const B = 4;

const key = (id: number, commander1: number, commander2: number | null, identity: number, months: Record<string, number>): CorpusKey => ({
  id,
  commander1,
  commander2,
  identity,
  deckCount: Object.values(months).reduce((a, b) => a + b, 0),
  deckMonths: months,
});

describe('keyRowSums', () => {
  const { sources } = pickCorpusSources([10, 20], [key(1, 10, 20, W | U, { '2026-01': 10 }), key(2, 10, null, W, { '2025-01': 40 })], settings);

  it('weights each key and counts decks too early for the card', () => {
    const rows: KeyCardCount[] = [
      { keyId: 1, decksWith: 4, eligibleDecks: 10 },
      { keyId: 2, decksWith: 8, eligibleDecks: 30 },
    ];
    expect(keyRowSums(sources, rows)).toEqual({ decksWith: 4 + 0.25 * 8, tooEarly: 0.25 * 10 });
  });

  it('ignores keys outside the sources and treats a missing eligible count as no early decks', () => {
    expect(keyRowSums(sources, [{ keyId: 99, decksWith: 5, eligibleDecks: 1 }, { keyId: 1, decksWith: 3, eligibleDecks: null }])).toEqual({
      decksWith: 3,
      tooEarly: 0,
    });
  });
});

describe('commanderCardCounts', () => {
  const { sources } = pickCorpusSources(
    [10, 20],
    [key(1, 10, 20, W | U, { '2025-06': 4, '2026-02': 6 }), key(2, 10, null, W, { '2025-01': 40 }), key(3, 20, null, U, { '2026-03': 12 })],
    settings,
  );

  it('counts the request decks only from sources whose colours allow the card, updated since its release', () => {
    const counts = commanderCardCounts(sources, { identity: U, releaseMonth: '2026-01' }, { decksWith: 2, tooEarly: 0 });
    // Key 1 (6 since January) and key 3 (12 at 0.25) allow blue; key 2 is mono-white.
    expect(counts.commanderDecks).toBeCloseTo(6 + 0.25 * 12);
    // The pool counts every deck of the allowing keys, less the early ones among the keys that ran it.
    expect(counts.poolDecks).toBeCloseTo(10 + 0.25 * 12);
  });

  it('never counts fewer decks than ran the card', () => {
    const counts = commanderCardCounts(sources, { identity: W, releaseMonth: '2027-01' }, { decksWith: 3, tooEarly: 50 });
    expect(counts.commanderDecks).toBe(3);
    expect(counts.poolDecks).toBe(3);
  });
});

describe('identityPoolDecks', () => {
  it('sums the weighted decks of every source that allows each identity', () => {
    const { sources } = pickCorpusSources([10], [key(1, 10, null, W, { '2026-01': 30 }), key(2, 10, 20, W | B, { '2026-01': 8 })], settings);
    const decks = identityPoolDecks(sources);
    expect(decks[0]).toBeCloseTo(30 + 0.25 * 8);
    expect(decks[W]).toBeCloseTo(30 + 0.25 * 8);
    expect(decks[B]).toBeCloseTo(0.25 * 8);
    expect(decks[U]).toBe(0);
  });
});

describe('addPoolScore', () => {
  it("matches the add pool's ordering expression (serving_partner_pool)", () => {
    const counts = { decksWith: 30, poolDecks: 80 };
    const baseline = 0.12;
    const inclusion = (30 + 20 * baseline) / (80 + 20);
    const sql = 0.6 * (0.5 + 0.5 * Math.max(-1, Math.min(1, (inclusion - baseline) / 0.3))) + 0.4 * Math.sqrt(Math.min(1, Math.max(inclusion, 0)));
    expect(addPoolScore(counts, baseline, 20, TEST_SCORING.corpus)).toBeCloseTo(sql, 12);
  });
});

describe('identityBaselineDecks', () => {
  it('counts decks of every identity that allows the card, since its release', () => {
    const months = new Map<number, Record<string, number>>([
      [W, { '2025-01': 5, '2026-05': 7 }],
      [W | U, { '2026-05': 3 }],
      [U, { '2026-05': 11 }],
    ]);
    expect(identityBaselineDecks(months, { identity: W, releaseMonth: '2026-01' })).toBe(10);
    expect(identityBaselineDecks(months, { identity: 0, releaseMonth: null })).toBe(26);
  });
});

describe('servedCardRates', () => {
  const baseline = { rate: 0.1, decksWith: 900, eligibleDecks: 9000 };

  it("shrinks the commander's decks toward the baseline and marks borrowed evidence", () => {
    const rates = servedCardRates({ decksWith: 30, commanderDecks: 60 }, baseline, settings, true);
    const inclusion = shrunkInclusion(30, 60, 0.1, 20);
    expect(rates.commanderRate).toEqual({ inclusion, synergy: inclusion - 0.1 });
    expect(rates.evidence).toEqual({
      scope: 'commander',
      decksWith: 30,
      commanderDeckCount: 60,
      inclusionRate: 0.5,
      synergy: Math.round((inclusion - 0.1) * 1000) / 1000,
      limited: false,
      pooled: true,
    });
  });

  it('falls back to the colour baseline when no source deck could have run the card', () => {
    const rates = servedCardRates({ decksWith: 0, commanderDecks: 0 }, baseline, settings, true);
    expect(rates.commanderRate).toBeNull();
    expect(rates.evidence).toEqual({ scope: 'colors', decksWith: 900, commanderDeckCount: 9000, inclusionRate: 0.1, synergy: 0, limited: false });
  });

  it('marks a card limited when neither its commander nor decks overall could have run enough of it', () => {
    const fresh = { rate: 0, decksWith: 0, eligibleDecks: 12 };
    expect(servedCardRates({ decksWith: 0, commanderDecks: 20 }, fresh, settings, false).evidence.limited).toBe(true);
    expect(servedCardRates({ decksWith: 0, commanderDecks: 60 }, fresh, settings, false).evidence.limited).toBe(false);
  });

  it('scores exactly as corpusComponent does', () => {
    const rates = servedCardRates({ decksWith: 30, commanderDecks: 75 }, baseline, settings, false);
    expect(servedCorpusScore(rates, settings, TEST_SCORING.corpus)).toEqual(
      corpusComponent(
        { commanderRate: rates.commanderRate, commanderDeckCount: 75, baseline: 0.1, baselineDeckCount: 9000 },
        settings, TEST_SCORING.corpus
      ),
    );
  });
});

describe('partnerRowSums', () => {
  it('gives a pair no key knows the same sums as borrowing every key of either partner', () => {
    // Partner 10 leads keys 1 and 2; partner 20 leads key 3. No key holds both.
    const keys = [
      key(1, 10, null, W, { '2025-01': 30, '2026-02': 20 }),
      key(2, 10, 30, W | B, { '2026-01': 9 }),
      key(3, 20, null, U, { '2024-12': 14 }),
    ];
    const rows: KeyCardCount[] = [
      { keyId: 1, decksWith: 12, eligibleDecks: 20 },
      { keyId: 2, decksWith: 3, eligibleDecks: 9 },
      { keyId: 3, decksWith: 5, eligibleDecks: 14 },
    ];
    const pair = pickCorpusSources([10, 20], keys, settings);
    const direct = keyRowSums(pair.sources, rows);

    const totalsFor = (commander: number) => {
      const own = keys.filter((k) => k.commander1 === commander || k.commander2 === commander);
      return keyRowSums(
        own.map((k) => ({ ...k, weight: 1, borrowed: false })),
        rows,
      );
    };
    const combined = partnerRowSums([totalsFor(10), totalsFor(20)], settings.partnerPoolWeight);
    expect(combined.decksWith).toBeCloseTo(direct.decksWith, 12);
    expect(combined.tooEarly).toBeCloseTo(direct.tooEarly, 12);
  });
});

describe('derivedPairRowSums', () => {
  // Partners 10 and 20 share key 4 (their own, under minDecks); 10 also leads keys 1 and 2, 20 leads key 3.
  const keys = [
    key(1, 10, null, W, { '2025-01': 30, '2026-02': 20 }),
    key(2, 10, 30, W | B, { '2026-01': 9 }),
    key(3, 20, null, U, { '2024-12': 14 }),
    key(4, 10, 20, W | U, { '2025-06': 3, '2026-03': 4 }),
  ];
  const ownKeyOf = (deckCount: number) => keys.map((k) => (k.id === 4 ? { ...k, deckCount, deckMonths: deckCount ? k.deckMonths : {} } : k));
  // The partner_card_totals rows: every key either commander leads or shares, at full weight.
  const totalsFor = (all: readonly CorpusKey[], commander: number, rows: readonly KeyCardCount[]) =>
    keyRowSums(
      all.filter((k) => k.commander1 === commander || k.commander2 === commander).map((k) => ({ ...k, weight: 1, borrowed: false })),
      rows,
    );
  const ownOf = (all: readonly CorpusKey[], rows: readonly KeyCardCount[]) =>
    keyRowSums(all.filter((k) => k.id === 4).map((k) => ({ ...k, weight: 1, borrowed: false })), rows);

  const cases: [string, KeyCardCount[]][] = [
    ['a card every key ran', [
      { keyId: 1, decksWith: 12, eligibleDecks: 20 },
      { keyId: 2, decksWith: 3, eligibleDecks: 9 },
      { keyId: 3, decksWith: 5, eligibleDecks: 14 },
      { keyId: 4, decksWith: 2, eligibleDecks: 4 },
    ]],
    ['a card the pair never ran', [
      { keyId: 1, decksWith: 12, eligibleDecks: 50 },
      { keyId: 3, decksWith: 5, eligibleDecks: 14 },
    ]],
    ['a card only one partner ran', [{ keyId: 3, decksWith: 7, eligibleDecks: 10 }]],
    ['a card only the pair ran, newer than some of its decks', [{ keyId: 4, decksWith: 1, eligibleDecks: 4 }]],
  ];

  it.each(cases)('matches summing the sources pickCorpusSources picks: %s', (_, rows) => {
    const picked = pickCorpusSources([10, 20], keys, settings);
    expect(picked.own?.id).toBe(4);
    const direct = keyRowSums(picked.sources, rows);
    const derived = derivedPairRowSums(ownOf(keys, rows), [totalsFor(keys, 10, rows), totalsFor(keys, 20, rows)], settings.partnerPoolWeight);
    expect(derived.decksWith).toBeCloseTo(direct.decksWith, 12);
    expect(derived.tooEarly).toBeCloseTo(direct.tooEarly, 12);
  });

  it('applies to a keyed pair that borrows, while a pool depth is set', () => {
    expect(isDerivedPair(2, pickCorpusSources([10, 20], keys, settings), 650)).toBe(true);
    expect(isDerivedPair(2, pickCorpusSources([10, 20], keys, settings), 0)).toBe(false);
    // No key of its own (a pair no key knows), or enough decks of its own to stand alone.
    expect(isDerivedPair(2, pickCorpusSources([10, 20], ownKeyOf(0), settings), 650)).toBe(false);
    expect(isDerivedPair(2, pickCorpusSources([10, 20], ownKeyOf(settings.minDecks), settings), 650)).toBe(false);
    expect(isDerivedPair(1, pickCorpusSources([10], keys, settings), 650)).toBe(false);
  });

  it('reduces to partnerRowSums when the pair has no decks of its own', () => {
    const all = ownKeyOf(0);
    const rows = cases[1]?.[1] ?? [];
    const partners = [totalsFor(all, 10, rows), totalsFor(all, 20, rows)];
    expect(derivedPairRowSums({ decksWith: 0, tooEarly: 0 }, partners, settings.partnerPoolWeight)).toEqual(
      partnerRowSums(partners, settings.partnerPoolWeight),
    );
    expect(keyRowSums(pickCorpusSources([10, 20], all, settings).sources, rows)).toEqual(partnerRowSums(partners, settings.partnerPoolWeight));
  });
});

describe('the EDHREC prior (T061)', () => {
  const capped = { ...settings, edhrecPriorCap: 200 };
  const page = { deckCount: 3000, floor: 0.05 };
  const baseline = { rate: 0.1, decksWith: 900, eligibleDecks: 9000 };

  it('is off without a page or with the cap at 0', () => {
    expect(cardPrior(null, { rate: 0.6, potentialDecks: 2500 }, 0.1, capped)).toBeNull();
    expect(cardPrior(page, { rate: 0.6, potentialDecks: 2500 }, 0.1, settings)).toBeNull();
  });

  it("shrinks toward the page's rate for a card it lists, and toward min(p0, floor) for one it leaves out", () => {
    expect(cardPrior(page, { rate: 0.6, potentialDecks: 2500 }, 0.1, capped)).toEqual({ target: 0.6, strength: 200, listed: true });
    expect(cardPrior(page, { rate: 0.6, potentialDecks: 80 }, 0.1, capped)).toEqual({ target: 0.6, strength: 80, listed: true });
    expect(cardPrior(page, null, 0.1, capped)).toEqual({ target: 0.05, strength: 200, listed: false });
    expect(cardPrior(page, null, 0.02, capped)).toEqual({ target: 0.02, strength: 200, listed: false });
  });

  it('carries the commander with no decks of our own, showing only the colours numbers', () => {
    const prior = cardPrior(page, { rate: 0.6, potentialDecks: 2500 }, baseline.rate, capped);
    const rates = servedCardRates({ decksWith: 0, commanderDecks: 0 }, baseline, capped, false, prior);
    expect(rates.commanderRate?.inclusion).toBeCloseTo(0.6);
    expect(rates.commanderDeckCount).toBe(200);
    expect(rates.hasExternalPrior).toBe(true);
    expect(rates.evidence.scope).toBe('colors');
    expect(servedCorpusScore(rates, capped, TEST_SCORING.corpus)?.weightScale).toBe(1);
  });

  it('counts our decks and the prior by their sizes, and our decks take over as they grow', () => {
    const prior = cardPrior(page, { rate: 0.6, potentialDecks: 2500 }, baseline.rate, capped);
    const few = servedCardRates({ decksWith: 2, commanderDecks: 10 }, baseline, capped, false, prior);
    expect(few.commanderRate?.inclusion).toBeCloseTo((2 + 200 * 0.6) / (10 + 200));
    expect(few.commanderDeckCount).toBe(210);
    expect(few.evidence.commanderDeckCount).toBe(10);
    const many = servedCardRates({ decksWith: 2000, commanderDecks: 10000 }, baseline, capped, false, prior);
    expect(many.commanderRate?.inclusion).toBeCloseTo((2000 + 120) / 10200);
  });

  it('changes nothing without a page', () => {
    const counts = { decksWith: 12, commanderDecks: 60 };
    expect(servedCardRates(counts, baseline, capped, false, null)).toEqual(servedCardRates(counts, baseline, settings, false));
    expect(addPoolScore({ decksWith: 12, poolDecks: 60 }, 0.1, 20, TEST_SCORING.corpus, null)).toBe(
      addPoolScore({ decksWith: 12, poolDecks: 60 }, 0.1, 20, TEST_SCORING.corpus),
    );
  });
});
