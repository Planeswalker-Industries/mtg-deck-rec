import type { RecEvent } from "@mtg/core/contract";
import type { AdminClient } from "./supabase-admin";

/** The database refused the event: no visitor key, or an event that doesn't add up. */
export class RecEventRefused extends Error {}

/**
 * Records one event for the live accept rate (T065), keyed to the signed-in account (`userId`, from the session) or
 * else to `visitor`, as swap votes are. Only the server may write events (`record_rec_event` is service_role's), so both
 * keys come from the session and the request, never from the caller.
 */
export async function recordRecEvent(db: AdminClient, event: RecEvent, visitor: string, userId: string | null): Promise<void> {
  const { error } = await db.rpc("record_rec_event", {
    p_visitor_key: visitor,
    ...(userId ? { p_user_id: userId } : {}),
    p_batch_id: event.batchId,
    p_kind: event.kind,
    p_mode: event.mode,
    p_card_ids: event.cardIds,
    ...(event.position !== undefined ? { p_position: event.position } : {}),
    ...(event.targetCardId !== undefined ? { p_target_card_id: event.targetCardId } : {}),
    p_commander_ids: event.commanderIds,
    p_bracket: event.bracket,
    p_collection: event.collection,
    ...(event.components ? { p_components: event.components } : {}),
  });
  if (error) {
    if (/VOTER_REQUIRED|INVALID_EVENT/.test(error.message)) throw new RecEventRefused(error.message);
    throw new Error(`Recording the event failed: ${error.message}`);
  }
}
