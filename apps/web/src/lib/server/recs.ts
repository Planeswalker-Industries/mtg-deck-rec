import { fitsIdentity, gameChangerLimit } from "@mtg/core/commander";
import type {
  AddResult,
  CardId,
  CardSummary,
  CostDelta,
  CutResult,
  CutSuggestion,
  RecContext,
  RecMode,
  SwapResult,
  SwapSuggestion,
  TagId,
  TagMatch,
  TagRef,
} from "@mtg/core/contract";
import {
  blendScore,
  manaValueProximity,
  scoreCuts,
  SWAP_WEIGHTS,
  TAG_SIMILARITY_FLOOR,
  type RoleTarget,
} from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary, type CardRow } from "./cards";
import type { PublicClient } from "./supabase";

/** How many tag-similar candidates the database returns before blending and trimming. */
const CANDIDATE_POOL = 120;
export const MAX_SWAP_LIMIT = 20;
export const MAX_CUT_LIMIT = 40;

export class NotFoundError extends Error {}

interface RawMatch {
  targetTagId: string;
  candidateTagId: string;
  viaTagId: string | null;
  distance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const frontType = (typeLine: string) => typeLine.split(" // ")[0] ?? typeLine;
const modeOf = (ctx: RecContext): RecMode => (ctx.ownership ? "collection_aware" : "collection_less");
const ownedIds = (ctx: RecContext): ReadonlySet<number> | null =>
  ctx.ownership?.kind === "session" ? new Set<number>(ctx.ownership.ownedCardIds) : null;
const identityMaskOf = (ctx: RecContext, rows: ReadonlyMap<number, CardRow>) =>
  ctx.deck.commanders.reduce((mask, id) => mask | (rows.get(id)?.color_identity ?? 0), 0);

function costDelta(target: CardSummary, replacement: CardSummary, owned: ReadonlySet<number> | null): CostDelta {
  const targetUsd = target.price?.usd;
  const replacementUsd = replacement.price?.usd;
  const asOf = replacement.price?.asOf ?? target.price?.asOf ?? null;
  if (owned?.has(replacement.id) && owned.has(target.id)) return { usd: 0, basis: "both_owned", asOf };
  if (owned?.has(replacement.id)) {
    return targetUsd === undefined
      ? { usd: null, basis: "price_unavailable", asOf: null }
      : { usd: -targetUsd, basis: "owned_replacement", asOf };
  }
  if (targetUsd === undefined || replacementUsd === undefined) return { usd: null, basis: "price_unavailable", asOf: null };
  return { usd: round2(replacementUsd - targetUsd), basis: "buy_replacement_vs_buy_target", asOf };
}

async function fetchTags(db: PublicClient, ids: readonly string[]): Promise<Map<string, TagRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("tags").select("id, slug, label").in("id", unique);
  if (error) throw new Error(`Loading tags failed: ${error.message}`);
  return new Map(data.map((t) => [t.id, { id: t.id as TagId, slug: t.slug, label: t.label }]));
}

export async function getSwapSuggestions(
  db: PublicClient,
  { context, targetCardId, limit = 10 }: { context: RecContext; targetCardId: number; limit?: number },
): Promise<SwapResult> {
  const deckIds = [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])];
  const deckRows = await fetchCardsById(db, [...deckIds, targetCardId]);
  const targetRow = deckRows.get(targetCardId);
  if (!targetRow) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);

  const owned = ownedIds(context);
  const mode = modeOf(context);
  const target = toCardSummary(targetRow);

  const [candidatesResult, tagCountResult] = await Promise.all([
    db.rpc("rec_swap_candidates", {
      p_target: targetCardId,
      p_exclude: deckIds,
      p_identity_mask: identityMaskOf(context, deckRows),
      p_allow_game_changers: context.includeGameChangers,
      p_owned: owned ? [...owned] : undefined,
      p_limit: CANDIDATE_POOL,
    }),
    db.rpc("rec_functional_tag_count", { p_card_id: targetCardId }),
  ]);
  if (candidatesResult.error) throw new Error(`Swap candidates failed: ${candidatesResult.error.message}`);
  if (tagCountResult.error) throw new Error(`Tag count failed: ${tagCountResult.error.message}`);

  const candidates = (candidatesResult.data ?? []).map((r) => ({ ...r, matches: r.matches as unknown as RawMatch[] }));
  const [candidateRows, tags] = await Promise.all([
    fetchCardsById(
      db,
      candidates.map((c) => c.card_id),
    ),
    fetchTags(
      db,
      candidates.flatMap((c) => c.matches.flatMap((m) => [m.targetTagId, m.candidateTagId, ...(m.viaTagId ? [m.viaTagId] : [])])),
    ),
  ]);

  const weights = SWAP_WEIGHTS[mode];
  const suggestions = candidates
    .flatMap((candidate): SwapSuggestion[] => {
      const row = candidateRows.get(candidate.card_id);
      if (!row || candidate.tag_similarity < TAG_SIMILARITY_FLOOR) return [];
      const card = toCardSummary(row);
      const matchedTags = candidate.matches.flatMap((m): TagMatch[] => {
        const targetTag = tags.get(m.targetTagId);
        const candidateTag = tags.get(m.candidateTagId);
        if (!targetTag || !candidateTag) return [];
        return [{ targetTag, candidateTag, via: m.viaTagId ? (tags.get(m.viaTagId) ?? null) : null, distance: m.distance }];
      });
      return [
        {
          card,
          matchedTags,
          corpus: null,
          votes: { score: 0.5, voteCount: 0, myVote: null },
          costDelta: costDelta(target, card, owned),
          owned: owned?.has(card.id) ? { quantity: 1 } : null,
          score: blendScore(
            {
              tag: round2(candidate.tag_similarity),
              manaValue: round2(manaValueProximity(card.manaValue, target.manaValue)),
              corpus: null,
              votes: null,
            },
            weights,
          ),
        },
      ];
    })
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);

  const result: SwapResult = { mode, target, confidence: "none", suggestions };
  if (suggestions.length === 0) {
    result.emptyReason = (tagCountResult.data ?? 0) === 0 ? "NO_TAGS_ON_TARGET" : owned ? "NOTHING_OWNED_FITS" : "NO_CANDIDATES";
  }
  return result;
}

function parseRoleTargets(value: unknown): RoleTarget[] {
  const roles = (value as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.flatMap((r): RoleTarget[] => {
    const { tagId, label, target } = (r ?? {}) as Record<string, unknown>;
    return typeof tagId === "string" && typeof label === "string" && typeof target === "number"
      ? [{ roleId: tagId, label, target }]
      : [];
  });
}

export async function getCutSuggestions(
  db: PublicClient,
  { context, limit = 20 }: { context: RecContext; limit?: number },
): Promise<CutResult> {
  const mainIds = [...new Set(context.deck.cards.filter((c) => c.section === "main").map((c) => c.cardId))];
  const [rows, configResult] = await Promise.all([
    fetchCardsById(db, [...mainIds, ...context.deck.commanders]),
    db.rpc("get_public_config", { p_key: "deck_role_targets" }),
  ]);
  if (configResult.error) throw new Error(`Loading role targets failed: ${configResult.error.message}`);
  const roleTargets = parseRoleTargets(configResult.data);

  const rolesResult = await db.rpc("rec_card_roles", { p_card_ids: mainIds, p_role_ids: roleTargets.map((r) => r.roleId) });
  if (rolesResult.error) throw new Error(`Loading card roles failed: ${rolesResult.error.message}`);
  const rolesByCard = new Map<number, string[]>();
  for (const { card_id, role_id } of rolesResult.data ?? []) rolesByCard.set(card_id, [...(rolesByCard.get(card_id) ?? []), role_id]);

  const identityMask = identityMaskOf(context, rows);
  const scored = scoreCuts(
    mainIds.flatMap((id) => {
      const row = rows.get(id);
      if (!row) return [];
      return [
        {
          cardId: id,
          manaValue: row.mana_value,
          isLand: /\bLand\b/.test(frontType(row.type_line)),
          isCommanderLegal: row.legal_commander === "legal",
          withinIdentity: context.deck.commanders.length === 0 || fitsIdentity(row.color_identity, identityMask),
          gameChanger: row.game_changer,
          roleIds: rolesByCard.get(id) ?? [],
        },
      ];
    }),
    { includeGameChangers: context.includeGameChangers, gameChangerLimit: gameChangerLimit(context.bracket), roleTargets },
  );

  const owned = ownedIds(context);
  const suggestions = scored.slice(0, limit).flatMap((s): CutSuggestion[] => {
    const row = rows.get(s.cardId);
    if (!row) return [];
    const notOwned = owned !== null && !owned.has(s.cardId);
    return [
      {
        card: toCardSummary(row),
        cutScore: s.cutScore,
        reasons: notOwned ? [...s.reasons, "NOT_OWNED"] : s.reasons,
        corpus: null,
        owned: owned?.has(s.cardId) ? { quantity: 1 } : null,
      },
    ];
  });
  return { mode: modeOf(context), confidence: "none", suggestions };
}

/** Cards to add come from play rates in other players' decks; until that corpus exists there's nothing honest to suggest. */
export async function getAddSuggestions(db: PublicClient, { context }: { context: RecContext }): Promise<AddResult> {
  const rows = await fetchCardsById(db, context.deck.commanders);
  const commanders = context.deck.commanders.flatMap((id) => {
    const row = rows.get(id);
    return row ? [toCardSummary(row)] : [];
  });
  return {
    mode: modeOf(context),
    commanderKey: { id: null, slug: null, commanders, deckCount: 0, confidence: "none" },
    confidence: "none",
    groups: [],
  };
}

export type { CardId };
