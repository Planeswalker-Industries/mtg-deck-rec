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
    const raw = (data as { curve?: Record<string, unknown> } | null)?.curve ?? {};
    const curve = Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === "number"));
    // Thrown, not returned, so an empty answer (no baseline yet) isn't cached and the next analysis asks again.
    if (Object.keys(curve).length === 0) throw new Error("The typical deck profile is empty.");
    return curve;
  });
}

/**
 * Deck stats' inputs, or null when its own reads fail: Deck stats is a display, so a missing typical deck profile (a
 * develop preview runs against main's schema) or a failed card roles read hides the readout and leaves the rest of the
 * analysis alone. The role targets and scoring config fail the analysis as before, as they do every recommendation.
 */
export async function loadStatInputs(db: PublicClient, cardIds: readonly number[]): Promise<StatInputs | null> {
  const [genericRoles, scoring, display] = await Promise.all([
    loadRoleTargets(db),
    loadScoringConfig(),
    Promise.all([loadTypicalCurve(db), loadCardRoles(db, cardIds)]).catch((cause: unknown) => {
      console.error("Deck stats inputs failed to load; the readout is hidden.", cause);
      return null;
    }),
  ]);
  if (!display) return null;
  const [typicalCurve, cardRoles] = display;
  return { genericRoles, typicalCurve, build: scoring.build, cardRoles };
}
