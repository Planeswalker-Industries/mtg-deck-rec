import { describe, expect, it } from 'vitest';
import { normalizeName, slugify } from './normalize';

describe('normalizeName', () => {
  it.each([
    ["Lim-Dûl's Vault", "lim-dul's vault"],
    ['Jötun Grunt', 'jotun grunt'],
    ['Kodama’s Reach', "kodama's reach"],
    ['Fire//Ice', 'fire // ice'],
    ['  Sea Gate Restoration   //  Sea Gate, Reborn ', 'sea gate restoration // sea gate, reborn'],
    ['Æther Vial', 'aether vial'],
    ['Who/What/When/Where/Why', 'who/what/when/where/why'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe('slugify', () => {
  it('builds URL-safe slugs without apostrophes or accents', () => {
    expect(slugify("Kodama's Reach")).toBe('kodamas-reach');
    expect(slugify("Lim-Dûl's Vault")).toBe('lim-duls-vault');
    expect(slugify('Sea Gate Restoration // Sea Gate, Reborn')).toBe('sea-gate-restoration-sea-gate-reborn');
  });
});
