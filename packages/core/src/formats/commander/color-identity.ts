import type { ColorIdentity } from '../../contract';

/** Canonical WUBRG order; the database stores identity as a bitmask W=1 U=2 B=4 R=8 G=16. */
export const COLOR_ORDER = 'WUBRG';

export function identityToMask(identity: ColorIdentity | readonly string[]): number {
  let mask = 0;
  for (const color of identity) {
    const bit = COLOR_ORDER.indexOf(color);
    if (bit >= 0) mask |= 1 << bit;
  }
  return mask;
}

export function maskToIdentity(mask: number): ColorIdentity {
  return [...COLOR_ORDER].filter((_, bit) => (mask & (1 << bit)) !== 0).join('');
}

/** A card fits a deck when every color in its identity is in the deck's identity. Colorless (0) fits anything. */
export function fitsIdentity(cardMask: number, deckMask: number): boolean {
  return (cardMask & ~deckMask) === 0;
}
