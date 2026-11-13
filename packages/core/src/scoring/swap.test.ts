import { describe, expect, it } from 'vitest';
import type { TagId, TagMatch, TagRef } from '../contract';
import { swapMatchLabel } from './swap';

const tag = (label: string): TagRef => ({ id: label as TagId, slug: label.toLowerCase().replace(/\W+/g, '-'), label });
/** A shared role as the role rung sends it: its own target and candidate tag. */
const role = (label: string): TagMatch => ({ targetTag: tag(label), candidateTag: tag(label), via: null, distance: 0 });

describe('swapMatchLabel (T088)', () => {
  const creature = { manaValue: 5, typeLine: 'Legendary Creature — Human Scientist Villain' };

  it('names the shared jobs on the role rung', () => {
    expect(swapMatchLabel({ match: 'role', matchedTags: [role('Ramp')] }, creature)).toBe('Same job: ramp');
    expect(swapMatchLabel({ match: 'role', matchedTags: [role('Ramp'), role('Card advantage'), role('Ramp')] }, creature)).toBe(
      'Same job: ramp, card advantage',
    );
    expect(swapMatchLabel({ match: 'role', matchedTags: [] }, creature)).toBe('Same job');
  });

  it('names the slot on the slot rung, by the card being replaced', () => {
    expect(swapMatchLabel({ match: 'slot', matchedTags: [] }, creature)).toBe('Similar slot: 5-mana creature');
    expect(swapMatchLabel({ match: 'slot', matchedTags: [] }, { manaValue: 2, typeLine: 'Artifact Creature — Golem' })).toBe(
      'Similar slot: 2-mana creature',
    );
    expect(swapMatchLabel({ match: 'slot', matchedTags: [] }, { manaValue: 0, typeLine: 'Land — Desert' })).toBe('Similar slot: land');
  });

  it('says nothing for the tags rung', () => {
    expect(swapMatchLabel({ match: 'tags', matchedTags: [role('Ramp')] }, creature)).toBeNull();
  });
});
