import type { ActionsApi, DataApi, RecsApi } from "@mtg/core/contract";
import { createMockApis } from "@mtg/core/mocks";
import { realActions, realRecs } from "./real";

export interface Apis {
  recs: RecsApi;
  actions: ActionsApi;
  data: DataApi;
}

let apis: Apis | undefined;

/**
 * Single access point for the contract APIs in client code.
 * Real catalog and recommendations by default; NEXT_PUBLIC_USE_MOCKS=1 switches everything to in-memory mocks.
 * DataApi (card and commander pages) has no real implementation yet.
 */
export function getApis(): Apis {
  if (apis) return apis;
  const mocks = createMockApis();
  apis =
    process.env.NEXT_PUBLIC_USE_MOCKS === "1"
      ? mocks
      : { recs: realRecs, actions: realActions, data: mocks.data };
  return apis;
}
