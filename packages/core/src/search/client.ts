import type { CollectionName, CollectionSchema } from "./documents";

/**
 * A small typed client for the Typesense REST API.
 *
 * Ours rather than the `typesense` package for the same reason `parse/csv.ts` is ours: we use six endpoints, the
 * wire format is JSON and JSONL, and `fetch` is everywhere both the app and the worker run. It also keeps
 * `@mtg/core` dependency-free, which matters because the contract package is imported into the browser bundle.
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
  url: string;
  apiKey: string;
  /** Reads are on a request path with its own budget, so this is short on purpose. */
  timeoutMs?: number;
}

export interface SearchParams {
  q: string;
  query_by?: string;
  query_by_weights?: string;
  filter_by?: string;
  sort_by?: string;
  per_page?: number;
  page?: number;
  prefix?: string | boolean;
  num_typos?: string | number;
  include_fields?: string;
  exclude_fields?: string;
  infix?: string;
  drop_tokens_threshold?: number;
  typo_tokens_threshold?: number;
}

export interface SearchHit<T> {
  document: T;
  text_match?: number;
}

export interface SearchResponse<T> {
  found: number;
  out_of?: number;
  hits?: SearchHit<T>[];
}

export interface ImportResult {
  imported: number;
  failures: { error: string; document?: string }[];
}

const DEFAULT_TIMEOUT_MS = 2_000;

/** Typesense refuses a page bigger than this, so every multi-get chunks to it. */
export const MAX_PER_PAGE = 250;

export class SearchClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor({ url, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }: SearchClientConfig) {
    this.base = url.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  private async requestText(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
    const { timeoutMs, ...rest } = init;
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
        ...rest,
        headers: { "X-TYPESENSE-API-KEY": this.apiKey, ...(rest.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      // A timeout and a refused connection are the same answer to the caller: use Postgres.
      throw new SearchError(err instanceof Error ? err.message : String(err), null);
    }
    const body = await response.text();
    if (!response.ok) throw new SearchError(`HTTP ${response.status}: ${body.slice(0, 300)}`, response.status);
    return body;
  }

  private async request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const body = await this.requestText(path, init);
    return (body ? JSON.parse(body) : null) as T;
  }

  async health(): Promise<boolean> {
    const result = await this.request<{ ok: boolean }>("/health");
    return result?.ok === true;
  }

  /** One document by its id, or null when the collection doesn't hold it. The cheapest question the index answers. */
  async retrieve<T>(collection: string, id: string): Promise<T | null> {
    try {
      return await this.request<T>(`/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof SearchError && err.status === 404) return null;
      throw err;
    }
  }

  async search<T>(collection: string, params: SearchParams): Promise<SearchResponse<T>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    return this.request<SearchResponse<T>>(`/collections/${encodeURIComponent(collection)}/documents/search?${query}`);
  }

  /**
   * Several searches in one round trip. Used for multi-get: a 500-id fetch is two 250-id filters, and sending them
   * as one POST also keeps long filters out of a URL.
   */
  async multiSearch<T>(searches: ({ collection: string } & SearchParams)[]): Promise<SearchResponse<T>[]> {
    if (searches.length === 0) return [];
    const result = await this.request<{ results: SearchResponse<T>[] }>("/multi_search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searches }),
    });
    return result.results ?? [];
  }

  /** Bulk upsert (or delete) as JSONL. `action: "upsert"` writes whole documents; missing ones are created. */
  async importDocuments(
    collection: string,
    documents: readonly Record<string, unknown>[],
    { action = "upsert", timeoutMs = 60_000 }: { action?: "create" | "upsert" | "update" | "emplace"; timeoutMs?: number } = {},
  ): Promise<ImportResult> {
    if (documents.length === 0) return { imported: 0, failures: [] };
    const body = documents.map((d) => JSON.stringify(d)).join("\n");
    // The import endpoint answers with one JSON object per line, not with a JSON document.
    const text = await this.requestText(`/collections/${encodeURIComponent(collection)}/documents/import?action=${action}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
      timeoutMs,
    });
    const lines = text.trim().split("\n").filter(Boolean);
    const failures: ImportResult["failures"] = [];
    for (const line of lines) {
      const parsed = JSON.parse(line) as { success: boolean; error?: string; document?: string };
      if (!parsed.success) failures.push({ error: parsed.error ?? "unknown", ...(parsed.document ? { document: parsed.document } : {}) });
    }
    return { imported: lines.length - failures.length, failures };
  }

  async deleteDocument(collection: string, id: string): Promise<boolean> {
    try {
      await this.request(`/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      return true;
    } catch (err) {
      // Deleting something already gone is the state the caller wanted.
      if (err instanceof SearchError && err.status === 404) return false;
      throw err;
    }
  }

  async deleteByFilter(collection: string, filterBy: string): Promise<number> {
    const result = await this.request<{ num_deleted: number }>(
      `/collections/${encodeURIComponent(collection)}/documents?filter_by=${encodeURIComponent(filterBy)}`,
      { method: "DELETE", timeoutMs: 60_000 },
    );
    return result?.num_deleted ?? 0;
  }

  async createCollection(schema: CollectionSchema): Promise<void> {
    await this.request("/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schema),
      timeoutMs: 30_000,
    });
  }

  async dropCollection(name: string): Promise<void> {
    try {
      await this.request(`/collections/${encodeURIComponent(name)}`, { method: "DELETE", timeoutMs: 60_000 });
    } catch (err) {
      if (err instanceof SearchError && err.status === 404) return;
      throw err;
    }
  }

  /** Whether a real collection goes by this name. A name that is only an alias answers 404 here. */
  async collectionExists(name: string): Promise<boolean> {
    const collections = await this.listCollections();
    return collections.some((c) => c.name === name);
  }

  async listCollections(): Promise<{ name: string; num_documents: number }[]> {
    return (await this.request<{ name: string; num_documents: number }[]>("/collections", { timeoutMs: 30_000 })) ?? [];
  }

  /** Points a stable name at a versioned collection, so a full rebuild is never a window with no index. */
  async upsertAlias(name: string, collectionName: string): Promise<void> {
    await this.request(`/aliases/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collection_name: collectionName }),
      timeoutMs: 30_000,
    });
  }

  async resolveAlias(name: string): Promise<string | null> {
    const alias = await this.request<{ collection_name: string } | null>(`/aliases/${encodeURIComponent(name)}`).catch((err: unknown) => {
      if (err instanceof SearchError && err.status === 404) return null;
      throw err;
    });
    return alias?.collection_name ?? null;
  }
}

export type { CollectionName };
