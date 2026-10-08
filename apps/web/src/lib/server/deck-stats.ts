import type { Profile, RoleTarget } from "@mtg/core/scoring";
import { cachedConfig } from "./config-cache";
import { loadRoleTargets } from "./recs";
import { loadScoringConfig } from "./scoring-config";
import { loadCardRoles } from "./serving";
import type { PublicClient } from "./supabase";

/** What Deck stats' targets need beyond the commander's corpus and the bracket rules (T045). */
export interface StatInputs {
  genericRoles: RoleTarget[];
  typicalCurve: Profile;
  build: { landCounts: readonly number[]; basicLandCounts: readonly number[] };
  /** The tracked role ids of the requested cards. */
  cardRoles: Map<number, string[]>;
}

/** The corpus-wide average curve, cached per instance like the other settings: it moves only with the nightly baseline. */
function loadTypicalCurve(db: PublicClient): Promise<Profile> {
  return cachedConfig("typical_deck_profile", async () => {
    const { data, error } = await db.rpc("typical_deck_profile");
    if (error) throw new Error(`Loading the typical deck profile failed: ${error.message}`);
    const curve = (data as { curve?: Record<string, unknown> } | null)?.curve ?? {};
    return Object.fromEntries(Object.entries(curve).filter((e): e is [string, number] => typeof e[1] === "number"));
  });
}

export async function loadStatInputs(db: PublicClient, cardIds: readonly number[]): Promise<StatInputs> {
  const [genericRoles, scoring, typicalCurve, cardRoles] = await Promise.all([
    loadRoleTargets(db),
    loadScoringConfig(),
    loadTypicalCurve(db),
    loadCardRoles(db, cardIds),
  ]);
  return { genericRoles, typicalCurve, build: scoring.build, cardRoles };
}
