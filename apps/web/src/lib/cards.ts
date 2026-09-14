import type { CardSummary, ResolvedLine } from "@mtg/core/contract";

/** Double-faced cards show their front face name: "Sea Gate Restoration // Sea Gate, Reborn" → "Sea Gate Restoration". */
export function displayName(card: Pick<CardSummary, "name">): string {
  return card.name.split(" // ")[0] ?? card.name;
}

export function findResolvedCard(lines: ResolvedLine[], cardId: number): CardSummary | null {
  for (const { resolution } of lines) {
    if (resolution.status === "resolved" && resolution.card.id === cardId) return resolution.card;
  }
  return null;
}
