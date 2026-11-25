import { describe, expect, it } from 'vitest';
import { canBeCommander, type CommanderEligibilityInput } from './eligibility';

// Real cards as the catalog holds them (front type line, rules text where it matters, front power/toughness).
// Checked 2026-11-25 against Scryfall's `is:commander legal:commander`: 3,754 cards, the same set this rule picks
// from the Oracle Cards bulk file. The only cards the rule alone would add are meld results (Brisela and four
// others): the catalog sync rules those out from their `all_parts`, since they never start in a deck.
const card = (frontTypeLine: string, pt: [string, string] | null = null, oracleText = ''): CommanderEligibilityInput => ({
  frontTypeLine,
  oracleText,
  frontPower: pt?.[0] ?? null,
  frontToughness: pt?.[1] ?? null,
});

describe('canBeCommander', () => {
  it.each([
    ['Sophina, Spearsage Deserter', card('Legendary Creature — Human Soldier', ['4', '4'])],
    ['Shorikai, Genesis Engine', card('Legendary Artifact — Vehicle', ['8', '8'])],
    ['Hearthhull, the Worldseed', card('Legendary Artifact — Spacecraft', ['6', '7'])],
    ['Inspirit, Flagship Vessel', card('Legendary Artifact — Spacecraft', ['5', '5'])],
    ['Infinite Guideline Station', card('Legendary Artifact — Spacecraft', ['7', '15'])],
    [
      'Grist, the Hunger Tide',
      card(
        'Legendary Planeswalker — Grist',
        null,
        "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.",
      ),
    ],
    ['Teferi, Temporal Archmage', card('Legendary Planeswalker — Teferi', null, 'Teferi, Temporal Archmage can be your commander.')],
    ["Ashaya's Enduring Bond", card('Legendary Sorcery', null, "Ashaya's Enduring Bond can be your commander.")],
    ['Candlekeep Sage', card('Legendary Enchantment — Background')],
  ])('%s can lead a deck', (_name, input) => {
    expect(canBeCommander(input)).toBe(true);
  });

  it.each([
    ["Smuggler's Copter (not legendary)", card('Artifact — Vehicle', ['3', '3'])],
    ['The Eternity Elevator (Spacecraft without power and toughness)', card('Legendary Artifact — Spacecraft')],
    ['Teferi, Master of Time (planeswalker without the text)', card('Legendary Planeswalker — Teferi')],
    ['Budoka Gardener (legendary only on its back face)', card('Creature — Human Monk', ['2', '1'])],
  ])('%s cannot', (_name, input) => {
    expect(canBeCommander(input)).toBe(false);
  });
});
