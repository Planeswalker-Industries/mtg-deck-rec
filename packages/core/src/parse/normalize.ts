/**
 * Canonical form for matching card names across sources (decklists, collection exports, Scryfall):
 * accents stripped, case-folded, curly quotes straightened, "//" separators spaced consistently.
 * Single slashes are left alone: some real card names contain them (Who/What/When/Where/Why).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/\s*\/\/\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL slug for card and commander pages. */
export function slugify(name: string): string {
  return normalizeName(name)
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
