import { describe, expect, it } from 'vitest';
import type { CardId } from '../../contract';
import { defaultIncludeGameChangers, estimateBracket, gameChangerLimit } from './bracket';
import { fitsIdentity, identityToMask, maskToIdentity } from './color-identity';
import { isValidPartnerPair, validateCommanderDeck, type CommanderCardFacts, type CommanderDeckEntry } from './validate';

let nextId = 1;
const card = (overrides: Partial<CommanderCardFacts> & { name: string }): CommanderCardFacts => ({
  id: nextId++ as CardId,
  colorIdentityMask: 0,
  legalCommander: 'legal',
  canBeCommander: false,
  partnerKind: null,
  partnerQualifier: null,
  copyLimit: null,
  gameChanger: false,
  ...overrides,
});
const main = (c: CommanderCardFacts, quantity = 1): CommanderDeckEntry => ({ card: c, quantity, section: 'main' });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('color identity', () => {
  it('round-trips between WUBRG strings and masks', () => {
    expect(identityToMask('WUG')).toBe(19);
    expect(identityToMask(['G', 'U', 'W'])).toBe(19);
    expect(maskToIdentity(19)).toBe('WUG');
    expect(maskToIdentity(0)).toBe('');
  });

  it('lets colorless cards into any deck and blocks off-color cards', () => {
    expect(fitsIdentity(0, identityToMask('G'))).toBe(true);
    expect(fitsIdentity(identityToMask('G'), identityToMask('WUG'))).toBe(true);
    expect(fitsIdentity(identityToMask('R'), identityToMask('WUG'))).toBe(false);
    expect(fitsIdentity(identityToMask('G'), 0)).toBe(false);
  });
});

describe('brackets', () => {
  it('estimates from Game Changers and mass land denial', () => {
    expect(estimateBracket({ gameChangerCount: 0 })).toBe(2);
    expect(estimateBracket({ gameChangerCount: 3 })).toBe(3);
    expect(estimateBracket({ gameChangerCount: 4 })).toBe(4);
    expect(estimateBracket({ gameChangerCount: 0, hasMassLandDenial: true })).toBe(4);
  });

  it('limits Game Changers per bracket', () => {
    expect(gameChangerLimit(2)).toBe(0);
    expect(gameChangerLimit(3)).toBe(3);
    expect(gameChangerLimit(4)).toBe(Number.POSITIVE_INFINITY);
    expect(defaultIncludeGameChangers(2)).toBe(false);
    expect(defaultIncludeGameChangers(3)).toBe(true);
  });
});

describe('partner pairs', () => {
  it('accepts each pairing mechanic and rejects mismatches', () => {
    const partner = card({ name: 'Thrasios', partnerKind: 'partner' });
    const partner2 = card({ name: 'Tymna', partnerKind: 'partner' });
    const pir = card({ name: 'Pir, Imaginative Rascal', partnerKind: 'partner_with', partnerQualifier: 'Toothy, Imaginary Friend' });
    const toothy = card({ name: 'Toothy, Imaginary Friend', partnerKind: 'partner_with', partnerQualifier: 'Pir, Imaginative Rascal' });
    const wilson = card({ name: 'Wilson, Refined Grizzly', partnerKind: 'choose_background' });
    const background = card({ name: 'Raised by Giants', partnerKind: 'background' });
    const survivorA = card({ name: 'A', partnerKind: 'partner_qualified', partnerQualifier: 'Survivors' });
    const survivorB = card({ name: 'B', partnerKind: 'partner_qualified', partnerQualifier: 'Survivors' });
    const fatherSon = card({ name: 'C', partnerKind: 'partner_qualified', partnerQualifier: 'Father & son' });

    expect(isValidPartnerPair(partner, partner2)).toBe(true);
    expect(isValidPartnerPair(pir, toothy)).toBe(true);
    expect(isValidPartnerPair(pir, partner)).toBe(false);
    expect(isValidPartnerPair(background, wilson)).toBe(true);
    expect(isValidPartnerPair(survivorA, survivorB)).toBe(true);
    expect(isValidPartnerPair(survivorA, fatherSon)).toBe(false);
    expect(isValidPartnerPair(wilson, partner)).toBe(false);
  });
});

describe('validateCommanderDeck', () => {
  const chulane = card({ name: 'Chulane, Teller of Tales', colorIdentityMask: identityToMask('WUG'), canBeCommander: true });

  it('reports size, identity, legality, singleton and Game Changer issues', () => {
    const bolt = card({ name: 'Lightning Bolt', colorIdentityMask: identityToMask('R') });
    const counterspell = card({ name: 'Counterspell', colorIdentityMask: identityToMask('U') });
    const banned = card({ name: 'Primeval Titan', colorIdentityMask: identityToMask('G'), legalCommander: 'banned' });
    const rift = card({ name: 'Cyclonic Rift', colorIdentityMask: identityToMask('U'), gameChanger: true });

    const issues = validateCommanderDeck([chulane], [main(bolt), main(counterspell, 2), main(banned), main(rift)], 2);
    expect(codes(issues).sort()).toEqual(
      ['NOT_LEGAL', 'OUTSIDE_COLOR_IDENTITY', 'OVER_BRACKET_GC_LIMIT', 'SINGLETON_VIOLATION', 'WRONG_DECK_SIZE'].sort(),
    );
  });

  it('allows any-number and limited-copy cards up to their limits', () => {
    const rats = card({ name: 'Relentless Rats', copyLimit: 0 });
    const dwarves = card({ name: 'Seven Dwarves', copyLimit: 7 });
    const forest = card({ name: 'Forest', colorIdentityMask: identityToMask('G'), copyLimit: 0 });
    const ok = validateCommanderDeck([card({ ...chulane, id: 999 as CardId, colorIdentityMask: 31 })], [main(rats, 30), main(dwarves, 7), main(forest, 20)], 3);
    expect(codes(ok)).not.toContain('SINGLETON_VIOLATION');
    expect(codes(validateCommanderDeck([chulane], [main(dwarves, 8)], 3))).toContain('SINGLETON_VIOLATION');
  });

  it('accepts a legal 100-card deck', () => {
    const fillers = Array.from({ length: 99 }, (_, i) => main(card({ name: `Card ${i}`, colorIdentityMask: identityToMask('G') })));
    expect(validateCommanderDeck([chulane], fillers, 3)).toEqual([]);
  });

  it('flags missing and invalid commanders', () => {
    expect(codes(validateCommanderDeck([], [], 3))).toContain('MISSING_COMMANDER');
    const notACommander = card({ name: 'Sol Ring' });
    expect(codes(validateCommanderDeck([notACommander], [], 3))).toContain('INVALID_COMMANDER');
  });
});
