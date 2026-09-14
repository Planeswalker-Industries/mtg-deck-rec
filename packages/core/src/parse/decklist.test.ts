import { describe, expect, it } from 'vitest';
import { parseDecklist } from './decklist';

const only = (text: string) => {
  const { lines } = parseDecklist(text);
  expect(lines).toHaveLength(1);
  return lines[0]!;
};

describe('parseDecklist: single lines', () => {
  it.each([
    ['1 Sol Ring', 1, 'Sol Ring'],
    ['1x Sol Ring', 1, 'Sol Ring'],
    ['3x  Relentless Rats', 3, 'Relentless Rats'],
    ['Sol Ring', 1, 'Sol Ring'],
    ["1 Lim-Dûl's Vault", 1, "Lim-Dûl's Vault"],
    ['1 Jötun Grunt', 1, 'Jötun Grunt'],
    ['1 Fire // Ice', 1, 'Fire // Ice'],
    ['1 Delver of Secrets // Insectile Aberration', 1, 'Delver of Secrets // Insectile Aberration'],
  ])('%s', (text, quantity, name) => {
    expect(only(text)).toMatchObject({ quantity, name, section: 'main', flags: [] });
  });

  it('reads set, collector number and finish', () => {
    expect(only('1 Sol Ring (C21) 263 *F*')).toMatchObject({ name: 'Sol Ring', setCode: 'C21', collectorNumber: '263', finish: 'foil' });
    expect(only('1 Sol Ring (cmm) 400 *E*')).toMatchObject({ setCode: 'CMM', collectorNumber: '400', finish: 'etched' });
    expect(only('1 Arcane Signet (SLD) 1234★')).toMatchObject({ collectorNumber: '1234★' });
  });

  it('strips Archidekt and Moxfield decorations', () => {
    expect(only('1x Sol Ring (cmm) 400 [Ramp]')).toMatchObject({ name: 'Sol Ring', setCode: 'CMM' });
    expect(only('1 Cultivate #!Ramp #Lands')).toMatchObject({ name: 'Cultivate' });
    expect(only('1x Swords to Plowshares [Removal] ^Have^')).toMatchObject({ name: 'Swords to Plowshares' });
  });

  it('maps Alchemy A- names to the paper card and flags them', () => {
    expect(only('1 A-Luminarch Aspirant')).toMatchObject({ name: 'Luminarch Aspirant', flags: ['alchemy_mapped'] });
  });

  it('skips quantity 0 lines and comments', () => {
    expect(parseDecklist('0 Sol Ring\n// just a note\n# another note\n1 Cultivate').lines.map((l) => l.name)).toEqual(['Cultivate']);
  });
});

describe('parseDecklist: sections', () => {
  it('follows headers in their common forms', () => {
    const { lines, usedHeaders } = parseDecklist(
      ['// Commander', '1 Chulane, Teller of Tales', '', 'Deck (2)', '1 Sol Ring', '1 Cultivate', 'Sideboard:', '1 Counterspell', 'Maybeboard', '1 Rhystic Study'].join('\n'),
    );
    expect(usedHeaders).toBe(true);
    expect(lines.map((l) => [l.name, l.section])).toEqual([
      ['Chulane, Teller of Tales', 'commander'],
      ['Sol Ring', 'main'],
      ['Cultivate', 'main'],
      ['Counterspell', 'sideboard'],
      ['Rhystic Study', 'maybeboard'],
    ]);
  });

  it('treats SB: prefixes as sideboard', () => {
    expect(only('SB: 2 Counterspell')).toMatchObject({ quantity: 2, name: 'Counterspell', section: 'sideboard' });
  });

  it('handles a BOM and Windows line endings', () => {
    expect(parseDecklist('﻿Commander\r\n1 Chulane, Teller of Tales\r\nDeck\r\n1 Sol Ring\r\n').lines.map((l) => l.section)).toEqual([
      'commander',
      'main',
    ]);
  });

  it('treats a short trailing block as the commander when there are no headers (MTGO)', () => {
    const { lines } = parseDecklist('1 Sol Ring\n1 Cultivate\n\n1 Chulane, Teller of Tales');
    expect(lines.map((l) => l.section)).toEqual(['main', 'main', 'commander']);
  });

  it('does not guess a commander when headers were used', () => {
    const { lines } = parseDecklist('Deck\n1 Sol Ring\n\n1 Cultivate');
    expect(lines.every((l) => l.section === 'main')).toBe(true);
  });

  it('records 1-based line numbers', () => {
    expect(parseDecklist('Commander\n1 Chulane, Teller of Tales').lines[0]?.lineNo).toBe(2);
  });

  it('ends a commander block at its blank line when no Deck header follows (Moxfield "// COMMANDER" export)', () => {
    const { lines } = parseDecklist('// COMMANDER\n1 Liesa, Forgotten Archangel\n\n1 Sol Ring\n12 Plains');
    expect(lines.map((l) => l.section)).toEqual(['commander', 'main', 'main']);
  });

  it('keeps partner commanders together when a blank line follows the header', () => {
    const { lines } = parseDecklist('Commander:\n\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n\nDeck\n1 Sol Ring');
    expect(lines.map((l) => l.section)).toEqual(['commander', 'commander', 'main']);
  });
});
