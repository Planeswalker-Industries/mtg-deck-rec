import type { Bracket, CardId, DeckIssue, DeckSection } from '../../contract';
import { gameChangerLimit } from './bracket';
import { fitsIdentity } from './color-identity';

/** The card facts Commander rules need; mirrors columns on public.cards. */
export interface CommanderCardFacts {
  id: CardId;
  name: string;
  colorIdentityMask: number;
  legalCommander: 'legal' | 'not_legal' | 'banned' | 'restricted';
  canBeCommander: boolean;
  partnerKind: string | null;
  partnerQualifier: string | null;
  /** null = one copy; 0 = any number; otherwise the printed limit (e.g. 7 for Seven Dwarves). */
  copyLimit: number | null;
  gameChanger: boolean;
}

export interface CommanderDeckEntry {
  card: CommanderCardFacts;
  quantity: number;
  section: DeckSection;
}

export const COMMANDER_DECK_SIZE = 100;

const frontName = (name: string) => name.split(' // ')[0] ?? name;

/** Whether two commanders may share the command zone. */
export function isValidPartnerPair(a: CommanderCardFacts, b: CommanderCardFacts): boolean {
  const kinds = new Set([a.partnerKind, b.partnerKind]);
  if (a.partnerKind === 'partner' && b.partnerKind === 'partner') return true;
  if (a.partnerKind === 'partner_with' && b.partnerKind === 'partner_with') {
    return a.partnerQualifier === frontName(b.name) && b.partnerQualifier === frontName(a.name);
  }
  if (a.partnerKind === 'partner_qualified' && b.partnerKind === 'partner_qualified') {
    return a.partnerQualifier !== null && a.partnerQualifier === b.partnerQualifier;
  }
  if (a.partnerKind === 'friends_forever' && b.partnerKind === 'friends_forever') return true;
  if (kinds.has('choose_background') && kinds.has('background')) return true;
  if (kinds.has('doctor') && kinds.has('doctors_companion')) return true;
  return false;
}

/** Union of the commanders' color identities. */
export function deckIdentityMask(commanders: readonly CommanderCardFacts[]): number {
  return commanders.reduce((mask, c) => mask | c.colorIdentityMask, 0);
}

/**
 * Checks a Commander deck. Issues are informational for pasted decks: recommendations still run,
 * and the UI shows what would make the deck legal.
 */
export function validateCommanderDeck(
  commanders: readonly CommanderCardFacts[],
  entries: readonly CommanderDeckEntry[],
  bracket: Bracket,
): DeckIssue[] {
  const issues: DeckIssue[] = [];
  const issue = (code: DeckIssue['code'], message: string, cardId?: CardId) =>
    issues.push(cardId === undefined ? { code, message } : { code, message, cardId });

  if (commanders.length === 0) issue('MISSING_COMMANDER', 'Pick a commander.');
  if (commanders.length > 2) issue('INVALID_COMMANDER', 'A deck can have at most two commanders.');
  for (const c of commanders) {
    if (!c.canBeCommander) issue('INVALID_COMMANDER', `${c.name} can't be your commander.`, c.id);
  }
  const [first, second] = commanders;
  if (first && second && commanders.length === 2 && !isValidPartnerPair(first, second)) {
    issue('INVALID_PARTNER_PAIR', `${first.name} and ${second.name} can't be commanders together.`);
  }

  const identity = deckIdentityMask(commanders);
  const deckCards = entries.filter((e) => e.section === 'main' || e.section === 'commander');
  const copies = new Map<CardId, { card: CommanderCardFacts; quantity: number }>();

  for (const { card, quantity } of [...commanders.map((card) => ({ card, quantity: 1 })), ...deckCards]) {
    const seen = copies.get(card.id);
    copies.set(card.id, { card, quantity: (seen?.quantity ?? 0) + quantity });
  }

  let gameChangers = 0;
  for (const { card, quantity } of copies.values()) {
    if (card.legalCommander !== 'legal') issue('NOT_LEGAL', `${card.name} isn't legal in Commander.`, card.id);
    if (commanders.length > 0 && !fitsIdentity(card.colorIdentityMask, identity)) {
      issue('OUTSIDE_COLOR_IDENTITY', `${card.name} is outside your commander's colors.`, card.id);
    }
    const limit = card.copyLimit === 0 ? Number.POSITIVE_INFINITY : (card.copyLimit ?? 1);
    if (quantity > limit) issue('SINGLETON_VIOLATION', `${card.name}: ${quantity} copies, but the limit is ${limit}.`, card.id);
    if (card.gameChanger) gameChangers++;
  }

  const size = [...copies.values()].reduce((n, c) => n + c.quantity, 0);
  if (size !== COMMANDER_DECK_SIZE) {
    issue('WRONG_DECK_SIZE', `Deck has ${size} cards; Commander decks have ${COMMANDER_DECK_SIZE}.`);
  }
  if (gameChangers > gameChangerLimit(bracket)) {
    issue('OVER_BRACKET_GC_LIMIT', `${gameChangers} Game Changers is over the limit for bracket ${bracket}.`);
  }
  return issues;
}
