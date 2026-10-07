import { parseScoringConfig, type ScoringConfig } from "@mtg/core/scoring";
import { cachedConfig } from "./config-cache";
import { createAdminClient } from "./supabase-admin";

/**
 * Every scoring weight and threshold (`app_config.scoring`, T057). The row is private, since the repo is public and
 * the weights are kept out of view too, so it is read with the server's secret key; never pass the result to client
 * code. Cached per server instance for a minute like the other settings. A missing or malformed row is an error.
 */
export function loadScoringConfig(): Promise<ScoringConfig> {
  return cachedConfig("scoring", async () => {
    const { data, error } = await createAdminClient().from("app_config").select("value").eq("key", "scoring").maybeSingle();
    if (error) throw new Error(`Loading scoring settings failed: ${error.message}`);
    return parseScoringConfig(data?.value);
  });
}
