import type { CardId, RecContext, RecEvent, RecEventMode, ScoreBreakdown } from "@mtg/core/contract";
import { MAX_REC_EVENT_CARDS, MAX_REC_EVENTS_PER_CALL } from "@mtg/core/schemas";
import { getApis } from "@/lib/api/client";

/**
 * The live accept rate (T065): the deck tool records each suggestion list it shows and what the player does with its
 * cards. Fire and forget: a failed or rate-limited event never reaches the player.
 */

/** A list as recorded: its batch id and its cards in the order shown, which decisions take their position from. */
export interface RecBatch {
  id: string;
  mode: RecEventMode;
  cardIds: CardId[];
  targetCardId?: CardId;
}

const settingsOf = (context: RecContext) => ({
  commanderIds: context.deck.commanders,
  bracket: context.bracket,
  collection: context.ownership ? (context.ownershipMode ?? "only") : ("none" as const),
});

const send = (event: RecEvent) =>
  void getApis()
    .actions.recordRecEvent(event)
    .catch(() => undefined);

/** Records a list shown and returns it as a batch for the decisions on its cards. */
export function recordShown(mode: RecEventMode, cardIds: readonly CardId[], context: RecContext, targetCardId?: CardId): RecBatch {
  const batch: RecBatch = {
    id: crypto.randomUUID(),
    mode,
    cardIds: cardIds.slice(0, MAX_REC_EVENT_CARDS),
    ...(targetCardId !== undefined ? { targetCardId } : {}),
  };
  if (batch.cardIds.length > 0) {
    send({
      kind: "shown",
      mode,
      batchId: batch.id,
      cardIds: batch.cardIds,
      ...(targetCardId !== undefined ? { targetCardId } : {}),
      ...settingsOf(context),
    });
  }
  return batch;
}

/** The event for a card from a recorded list taken or passed on, or null when the list didn't show the card. */
function decisionEvent(batch: RecBatch, cardId: CardId, accepted: boolean, context: RecContext, score?: ScoreBreakdown): RecEvent | null {
  const position = batch.cardIds.indexOf(cardId);
  if (position < 0) return null;
  return {
    kind: accepted ? "accepted" : "declined",
    mode: batch.mode,
    batchId: batch.id,
    cardIds: [cardId],
    position,
    ...(batch.targetCardId !== undefined ? { targetCardId: batch.targetCardId } : {}),
    ...settingsOf(context),
    ...(score ? { components: score.components } : {}),
  };
}

/** Records a card from a recorded list taken or passed on; a card the list didn't show is not recorded. */
export function recordDecision(batch: RecBatch, cardId: CardId, accepted: boolean, context: RecContext, score?: ScoreBreakdown): void {
  const event = decisionEvent(batch, cardId, accepted, context, score);
  if (event) send(event);
}

/** A card taken or passed on, as recordDecisions takes it. */
export interface RecDecision {
  cardId: CardId;
  accepted: boolean;
  score?: ScoreBreakdown;
}

/** Records many decisions on one recorded list in one call (a build's acceptance, a Cut step); unshown cards are skipped. */
export function recordDecisions(batch: RecBatch, decisions: readonly RecDecision[], context: RecContext): void {
  const events = decisions
    .map((d) => decisionEvent(batch, d.cardId, d.accepted, context, d.score))
    .filter((e): e is RecEvent => e !== null)
    .slice(0, MAX_REC_EVENTS_PER_CALL);
  if (events.length === 0) return;
  void getApis()
    .actions.recordRecEvents({ events })
    .catch(() => undefined);
}
