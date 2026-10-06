import { describe, expect, it } from 'vitest';
import type { CardId } from '../../contract';
import { identityToMask } from './color-identity';
import { checkCorpusDeck, corpusCommanders, type CorpusCommanderFacts, type CorpusDeckFacts } from './corpus';

let nextId = 100;
const card = (overrides: Partial<CorpusCommanderFacts> & { name: string }): CorpusCommanderFacts => ({
  id: nextId++ as CardId,
  colorIdentityMask: 0,
  legalCommander: 'legal',
  canBeCommander: true,
  partnerKind: null,
  partnerQualifier: null,
  ...overrides,
});

const deck = (overrides: Partial<CorpusDeckFacts> = {}): CorpusDeckFacts => ({
  commanders: [card({ name: 'Liesa, Forgotten Archangel', colorIdentityMask: identityToMask('WB') })],
  unresolvedCards: 0,
  cardsIdentity: identityToMask('W'),
  deckSize: 100,
  ...overrides,
});

describe('corpusCommanders', () => {
  it('sorts a legal pair by card id and joins their colours', () => {
    const tymna = card({ name: 'Tymna the Weaver', colorIdentityMask: identityToMask('WB'), partnerKind: 'partner' });
    const thrasios = card({ name: 'Thrasios, Triton Hero', colorIdentityMask: identityToMask('UG'), partnerKind: 'partner' });
    const result = corpusCommanders([thrasios, tymna]);
    expect(result).toEqual({ ok: true, commanders: [tymna, thrasios], identity: identityToMask('WUBG') });
  });

  it('lets a Background lead with a commander that chooses one', () => {
    const wilson = card({ name: 'Wilson, Refined Grizzly', partnerKind: 'choose_background' });
    const background = card({ name: 'Raised by Giants', canBeCommander: false, partnerKind: 'background' });
    expect(corpusCommanders([wilson, background]).ok).toBe(true);
  });

  it('refuses what the command zone does not allow', () => {
    const lone = card({ name: 'Lone' });
    expect(corpusCommanders([])).toEqual({ ok: false, reason: 'commander_count' });
    expect(corpusCommanders([lone, card({ name: 'Two' }), card({ name: 'Three' })])).toEqual({ ok: false, reason: 'commander_count' });
    expect(corpusCommanders([lone, undefined])).toEqual({ ok: false, reason: 'unresolved_commander' });
    expect(corpusCommanders([card({ name: 'Banned', legalCommander: 'banned' })])).toEqual({ ok: false, reason: 'commander_not_legal' });
    expect(corpusCommanders([card({ name: 'Companion', canBeCommander: false })])).toEqual({ ok: false, reason: 'no_eligible_commander' });
    expect(corpusCommanders([lone, card({ name: 'Not a partner' })])).toEqual({ ok: false, reason: 'invalid_partner_pair' });
    expect(corpusCommanders([lone, lone])).toEqual({ ok: false, reason: 'invalid_partner_pair' });
  });
});

describe('checkCorpusDeck', () => {
  it('passes a complete deck inside its colours', () => {
    const facts = deck();
    expect(checkCorpusDeck(facts)).toEqual({ ok: true, commanderIds: [facts.commanders[0]?.id], identity: identityToMask('WB') });
  });

  it('keeps a deck naming a card the catalog lacks out, to wait for the catalog', () => {
    expect(checkCorpusDeck(deck({ unresolvedCards: 1 }))).toEqual({ ok: false, reason: 'unresolved_cards' });
  });

  it('refuses a card outside the commanders’ colours', () => {
    expect(checkCorpusDeck(deck({ cardsIdentity: identityToMask('WR') }))).toEqual({ ok: false, reason: 'outside_identity' });
  });

  it('counts only decks of exactly 100 cards', () => {
    expect(checkCorpusDeck(deck({ deckSize: 99 }))).toEqual({ ok: false, reason: 'not_100_cards' });
    expect(checkCorpusDeck(deck({ deckSize: 101 }))).toEqual({ ok: false, reason: 'not_100_cards' });
  });

  it('checks the commanders before the cards', () => {
    expect(checkCorpusDeck(deck({ commanders: [undefined], unresolvedCards: 3, deckSize: 60 }))).toEqual({
      ok: false,
      reason: 'unresolved_commander',
    });
  });
});
