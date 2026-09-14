import type { Bracket } from '../../contract';

/** Game Changers allowed per bracket (Commander Brackets, Feb 2026 update). */
export function gameChangerLimit(bracket: Bracket): number {
  if (bracket <= 2) return 0;
  if (bracket === 3) return 3;
  return Number.POSITIVE_INFINITY;
}

/** Game Changers are excluded from suggestions by default for brackets 1–2 and included for 3–5. */
export function defaultIncludeGameChangers(bracket: Bracket): boolean {
  return bracket >= 3;
}

export interface BracketSignals {
  gameChangerCount: number;
  /** Mass land denial pushes a deck to bracket 4 regardless of Game Changers. */
  hasMassLandDenial?: boolean;
}

/**
 * A rough estimate, labelled as such in the UI. Game Changer count is the only signal we can read reliably:
 * brackets 1 vs 2 and 4 vs 5 depend on intent, so the estimate never returns 1 or 5.
 */
export function estimateBracket({ gameChangerCount, hasMassLandDenial = false }: BracketSignals): Bracket {
  if (hasMassLandDenial || gameChangerCount > 3) return 4;
  if (gameChangerCount > 0) return 3;
  return 2;
}
