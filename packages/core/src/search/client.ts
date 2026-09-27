import type { CardDocument, CollectionSchema, CommanderCardDocument, TagDocument } from "./documents";

/**
 * Client for the search API (services/search-api), which is the only thing that talks to Typesense.
 *
 * Nothing here knows Typesense's REST API. The endpoints are shaped around the questions this project asks — "these
 * 500 cards", "does this slug have a page", "the play rates for these keys and cards" — so chunking, paging and the
 * search ranking live on the far side, in one place, instead of being rebuilt by every caller.
 *
 * Ours rather than a generated client for the same reason `parse/csv.ts` is ours: a dozen endpoints and a JSON wire
 * format. It also keeps `@mtg/core` dependency-free, which matters because the contract package is imported into
 * the browser bundle.
 *
 * Every call has a timeout. Reads never retry — the caller falls back to Postgres, which is always faster than
 * waiting twice. Writes never retry either: the queue the worker drains is the retry.
 */

export class SearchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SearchError";
  }
}

export interface SearchClientConfig {
  /** The search API's base URL. */
  url: string;
  /** The read token for the app, or the admin token for the worker. */
  token: string;
  /** Reads sit on a request path with its own budget, so this is short on purpose. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2_000;
/** Bulk imports and rebuilds are patient; they run after a sync has already committed. */
const WRITE_TIMEOUT_MS = 120_000;

export class SearchClient {
  private readonly base: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor({ url, token, timeoutMs = DEFAULT_TIMEOUT_MS }: SearchClientConfig) {
    this.base = url.replace(/\/+$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(
    path: string,
    { timeoutMs, body, method = "GET", contentType = "application/json" }: {
      timeoutMs?: number;
      body?: string;
      method?: string;
      contentType?: string;
    } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": contentType }),
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      // A timeout and a refused connection are the same answer to the caller: use Postgres.
      throw new SearchError(err instanceof Error ? err.message : String(err), null);
    }
    const text = await response.text();
    if (!response.ok) throw new SearchError(`HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Unauthenticated on the far side, and the one call that says whether the index is usable at all. */
  async health(): Promise<boolean> {
    const result = await this.request<{ ok: boolean }>("/v1/health");
    return result?.ok === true;
  }

  // --- reads ---

  /** The hottest call in the app: a swap pool is 220 cards, an add pool 400, a commander page 500. */
  async cardsByID(ids: readonly number[]): Promise<CardDocument[]> {
    if (ids.length === 0) return [];
    const result = await this.request<{ cards: CardDocument[] }>("/v1/cards/by-id", {
      method: "POST",
      body: JSON.stringify({ ids: [...ids] }),
    });
    return result.cards ?? [];
  }

  /**
   * Cards by name, and the deckbuilder's narrowed search.
   *
   * With `colorIdentity`, `cardType` or `manaValue` set this is the deckbuilder asking, and an empty `q` means browse
   * the filtered cards by play rate rather than search for nothing. `colorIdentity` is the deck's identity as WUBRG
   * letters, and `""` is a colourless deck — which is why it travels beside a `colorless` flag: an empty string and
   * an absent one are different questions and a query string cannot tell them apart.
   */
  async searchCards({
    q,
    commanderOnly = false,
    limit = 8,
    colorIdentity,
    cardType,
    manaValue,
    offset,
    builder = false,
  }: {
    q: string;
    commanderOnly?: boolean;
    limit?: number;
    colorIdentity?: string | undefined;
    cardType?: string | undefined;
    manaValue?: number | undefined;
    offset?: number | undefined;
    builder?: boolean;
  }): Promise<CardDocument[]> {
    const query = new URLSearchParams({ q, limit: String(limit) });
    if (commanderOnly) query.set("commanderOnly", "1");
    if (colorIdentity !== undefined) {
      query.set("colors", colorIdentity);
      if (colorIdentity === "") query.set("colorless", "1");
    }
    if (cardType !== undefined) query.set("type", cardType);
    if (manaValue !== undefined) query.set("mv", String(manaValue));
    if (offset !== undefined && offset > 0) query.set("offset", String(offset));
    if (builder) query.set("builder", "1");
    const result = await this.request<{ cards: CardDocument[] }>(`/v1/cards/search?${query}`);
    return result.cards ?? [];
  }

  /** Whether a slug is a real page. A hit is conclusive; the caller decides what a miss means. */
  async pageExists(kind: "card" | "commander", slug: string): Promise<boolean> {
    const result = await this.request<{ exists: boolean }>(`/v1/pages/${kind}/${encodeURIComponent(slug)}`);
    return result.exists === true;
  }

  /** Every Tagger tag. Paged on the far side, so this is one request rather than nineteen. */
  async allTags(): Promise<TagDocument[]> {
    const result = await this.request<{ tags: TagDocument[] }>("/v1/tags", { timeoutMs: Math.max(this.timeoutMs, 5_000) });
    return result.tags ?? [];
  }

  async commanderCardRates({ keyIds, cardIds }: { keyIds: readonly number[]; cardIds: readonly number[] }): Promise<CommanderCardDocument[]> {
    if (keyIds.length === 0 || cardIds.length === 0) return [];
    const result = await this.request<{ rates: CommanderCardDocument[] }>("/v1/commander-cards/rates", {
      method: "POST",
      body: JSON.stringify({ keyIds: [...keyIds], cardIds: [...cardIds] }),
    });
    return result.rates ?? [];
  }

  /** The cards a commander's decks play most, by shrunk inclusion — ids only; the caller scores them itself. */
  async commanderCardsTop({ keyIds, limit }: { keyIds: readonly number[]; limit: number }): Promise<number[]> {
    if (keyIds.length === 0) return [];
    const query = new URLSearchParams({ keyIds: keyIds.join(","), limit: String(limit) });
    const result = await this.request<{ cardIds: number[] }>(`/v1/commander-cards/top?${query}`);
    return result.cardIds ?? [];
  }

  // --- writes (the worker's admin token only) ---

  async listCollections(): Promise<{ name: string; numDocuments: number }[]> {
    const result = await this.request<{ collections: { name: string; numDocuments: number }[] }>("/v1/admin/collections", {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return result.collections ?? [];
  }

  async collectionExists(name: string): Promise<boolean> {
    return (await this.listCollections()).some((c) => c.name === name);
  }

  async createCollection(schema: CollectionSchema): Promise<void> {
    await this.request("/v1/admin/collections", { method: "POST", body: JSON.stringify(schema), timeoutMs: WRITE_TIMEOUT_MS });
  }

  async dropCollection(name: string): Promise<void> {
    await this.request(`/v1/admin/collections/${encodeURIComponent(name)}`, { method: "DELETE", timeoutMs: WRITE_TIMEOUT_MS });
  }

  /** Bulk upsert as JSONL, which is what the far side hands Typesense unchanged. */
  async importDocuments(collection: string, documents: readonly Record<string, unknown>[]): Promise<{ imported: number; failures: string[] }> {
    if (documents.length === 0) return { imported: 0, failures: [] };
    const result = await this.request<{ imported: number; failures: string[] }>(
      `/v1/admin/collections/${encodeURIComponent(collection)}/import`,
      {
        method: "POST",
        body: documents.map((d) => JSON.stringify(d)).join("\n"),
        contentType: "application/x-ndjson",
        timeoutMs: WRITE_TIMEOUT_MS,
      },
    );
    return { imported: result.imported ?? 0, failures: result.failures ?? [] };
  }

  /** True when a document was there to delete; false when it was already gone, which is the state the caller wanted. */
  async deleteDocument(collection: string, id: string): Promise<boolean> {
    const result = await this.request<{ deleted: boolean }>(
      `/v1/admin/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`,
      { method: "DELETE", timeoutMs: WRITE_TIMEOUT_MS },
    );
    return result.deleted === true;
  }

  /** The collection an alias points at, or null when there is no such alias. */
  async resolveAlias(name: string): Promise<string | null> {
    const result = await this.request<{ collectionName: string | null }>(`/v1/admin/aliases/${encodeURIComponent(name)}`, {
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return result.collectionName ?? null;
  }

  /** Points a stable name at a versioned collection, so a full rebuild is never a window with no index. */
  async upsertAlias(name: string, collectionName: string): Promise<void> {
    await this.request(`/v1/admin/aliases/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ collectionName }),
      timeoutMs: WRITE_TIMEOUT_MS,
    });
  }
}
