import type { VoteContext, VoteSummary } from "@mtg/core/contract";
import type { PublicClient } from "./supabase";

export interface SwapVoteInput {
  targetCardId: number;
  replacementCardId: number;
  value: -1 | 0 | 1;
  commanderKeyId?: number | undefined;
  context?: VoteContext | undefined;
}

const REFUSALS = ["VOTER_REQUIRED", "INVALID_VOTE", "UNKNOWN_CARD"] as const;
export type VoteRefusal = (typeof REFUSALS)[number];

/** The database refused the vote: no voter, an invalid vote, or a card that isn't in the catalog. */
export class VoteRefused extends Error {
  constructor(readonly reason: VoteRefusal) {
    super(reason);
  }
}

function readSummary(value: unknown): VoteSummary {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.score !== "number" || typeof v.voteCount !== "number") {
    throw new Error("A vote summary came back in an unexpected shape.");
  }
  const myVote = v.myVote === -1 || v.myVote === 0 || v.myVote === 1 ? v.myVote : null;
  return { score: v.score, voteCount: v.voteCount, myVote };
}

/**
 * Records, changes or clears (value 0) a swap vote, then returns the pair's summary. The database keys a signed-in
 * voter to their account from the session on `db`; everyone else is keyed by `visitor`.
 */
export async function castSwapVote(db: PublicClient, input: SwapVoteInput, visitor: string): Promise<VoteSummary> {
  const { context } = input;
  const { data, error } = await db.rpc("cast_swap_vote", {
    p_visitor_key: visitor,
    p_target: input.targetCardId,
    p_replacement: input.replacementCardId,
    p_value: input.value,
    ...(input.commanderKeyId !== undefined ? { p_commander_key_id: input.commanderKeyId } : {}),
    ...(context
      ? {
          p_source: context.source,
          p_session_id: context.sessionId,
          p_commander_ids: context.commanderIds,
          p_position: context.position,
          p_shown_card_ids: context.shownCardIds,
          p_matched_tag_ids: context.matchedTagIds,
        }
      : {}),
  });
  if (error) {
    const reason = REFUSALS.find((r) => error.message.includes(r));
    if (reason) throw new VoteRefused(reason);
    throw new Error(`Saving the vote failed: ${error.message}`);
  }
  return readSummary(data);
}
