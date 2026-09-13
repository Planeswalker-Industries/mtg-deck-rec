import type { ActionsApi, DataApi, RecsApi } from "@mtg/core/contract";
import { createMockApis } from "@mtg/core/mocks";

export interface Apis {
  recs: RecsApi;
  actions: ActionsApi;
  data: DataApi;
}

let apis: Apis | undefined;

/**
 * Single access point for the contract APIs in client code.
 * Backed by in-memory mocks until the real transports (Route Handlers / Server Actions) exist;
 * swapping implementations must not change call sites.
 */
export function getApis(): Apis {
  apis ??= createMockApis();
  return apis;
}
