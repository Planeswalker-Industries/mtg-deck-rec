import type { Profile, RoleTarget } from "@mtg/core/scoring";
import { cachedConfig } from "./config-cache";
import { loadRoleTargets } from "./recs";
import { loadScoringConfig } from "./scoring-config";
import { loadCardRoles } from "./serving";
import type { PublicClient } from "./supabase";

/** Commander keys per deck: one commander or a partner pair, as the corpus read allows. */
const MAX_COMMANDERS = 2;

/** What Deck stats' targets need beyond the commander's corpus and the bracket rules (T045). */
export interface StatInputs {
  genericRoles: RoleTarget[];
  typicalCurve: Profile;
  /** Empty while typical decks have no type profile (T071): Deck stats then leaves the types out. */
  typicalTypes: Profile;
  /** Each key either commander leads or shares → its stored type profile (unparsed), for `sourcesProfile`. */
  keyTypeProfiles: Map<number, unknown>;
  build: { landCounts: readonly number[]; basicLandCounts: readonly number[]; colourSourceCaps: readonly (number | null)[] };
  /** The tracked role ids of the requested cards. */
  cardRoles: Map<number, string[]>;
}

const numbersOf = (raw: Record<string, unknown> | undefined): Profile =>
  Object.fromEntries(Object.entries(raw ?? {}).filter((e): e is [string, number] => typeof e[1] === "number"));

/** The corpus-wide average curve and types, cached per instance like the other settings: they move only with the baseline. */
function loadTypicalProfile(db: PublicClient): Promise<{ curve: Profile; types: Profile }> {
  return cachedConfig("typical_deck_profile", async () => {
    const { data, error } = await db.rpc("typical_deck_profile");
    if (error) throw new Error(`Loading the typical deck profile failed: ${error.message}`);
    const value = data as { curve?: Record<string, unknown>; types?: Record<string, unknown> } | null;
    const curve = numbersOf(value?.curve);
    // Thrown, not returned, so an empty answer (no baseline yet) isn't cached and the next analysis asks again.
    if (Object.keys(curve).length === 0) throw new Error("The typical deck profile is empty.");
    return { curve, types: numbersOf(value?.types) };
  });
}

/**
 * The type profiles of every key either commander leads or shares (T071). Read apart from the corpus, which
 * recommendations share and which never needs them, and empty on failure: a develop preview runs against main's
 * schema, where the column may not exist yet, and the types then just stay out of Deck stats.
 */
async function loadKeyTypeProfiles(db: PublicClient, commanderIds: readonly number[]): Promise<Map<number, unknown>> {
  const ids = [...new Set(commanderIds)];
  if (ids.length === 0 || ids.length > MAX_COMMANDERS) return new Map();
  const idList = ids.join(",");
  const { data, error } = await db
    .from("commander_keys")
    .select("id, commander_stats(type_profile)")
    .or(`commander_1.in.(${idList}),commander_2.in.(${idList})`);
  if (error) {
    console.error("Loading the commanders' type profiles failed; Deck stats leaves the types out.", error.message);
    return new Map();
  }
  return new Map((data as { id: number; commander_stats: { type_profile: unknown } | null }[]).map((k) => [k.id, k.commander_stats?.type_profile]));
}

/**
 * Deck stats' inputs, or null when its own reads fail: Deck stats is a display, so a missing typical deck profile (a
 * develop preview runs against main's schema) or a failed card roles read hides the readout and leaves the rest of the
 * analysis alone. The role targets and scoring config fail the analysis as before, as they do every recommendation.
 */
export async function loadStatInputs(db: PublicClient, commanderIds: readonly number[], cardIds: readonly number[]): Promise<StatInputs | null> {
  const [genericRoles, scoring, display, keyTypeProfiles] = await Promise.all([
    loadRoleTargets(db),
    loadScoringConfig(),
    Promise.all([loadTypicalProfile(db), loadCardRoles(db, cardIds)]).catch((cause: unknown) => {
      console.error("Deck stats inputs failed to load; the readout is hidden.", cause);
      return null;
    }),
    loadKeyTypeProfiles(db, commanderIds),
  ]);
  if (!display) return null;
  const [typical, cardRoles] = display;
  return { genericRoles, typicalCurve: typical.curve, typicalTypes: typical.types, keyTypeProfiles, build: scoring.build, cardRoles };
}
