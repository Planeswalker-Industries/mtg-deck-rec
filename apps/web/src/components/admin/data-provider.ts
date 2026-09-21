"use client";

import type { DataProvider, GetListParams, GetManyReferenceParams, RaRecord } from "react-admin";
import { HttpError } from "react-admin";
import {
  ADMIN_USER_SORTS,
  type AdminSyncRun,
  type AdminSyncRunPage,
  type AdminTag,
  type AdminTagPage,
  type AdminTagSort,
  type AdminUser,
  type AdminUserPage,
} from "@/lib/admin/types";

/**
 * React Admin talks to our own /api/admin routes, not to Supabase directly.
 *
 * Why not `ra-supabase` and PostgREST from the browser: the admin list joins `auth.users`, which no API role can read,
 * and every admin write is a security-definer function with guards rather than a table update. Routing through the app
 * keeps all of that server-side, keeps the session in the same http-only cookies the rest of the site uses, and means
 * the admin bundle carries no Supabase credentials or query building at all.
 *
 * `platform-admins` is `users` with the admins-only filter pinned on, so the menu can offer "who has access" without
 * a second endpoint to keep in step. Tags and sync runs have endpoints of their own under /api/admin.
 */

const USERS = "/api/admin/users";
const TAGS = "/api/admin/tags";
const SYNC_RUNS = "/api/admin/sync-runs";

/** React Admin's default page size, used when a list asks without saying. */
const DEFAULT_PER_PAGE = 25;

interface Failure {
  ok: false;
  error: { code: string; message: string; fieldErrors?: Record<string, string> };
}
type Envelope<T> = { ok: true; data: T } | Failure;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    // The session is an http-only cookie; nothing here carries a token of its own.
    credentials: "same-origin",
  });

  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // An empty or non-JSON body (a proxy error page) falls through to the status below.
  }

  if (!response.ok || !body || body.ok !== true) {
    const error = body && body.ok === false ? body.error : undefined;
    throw new HttpError(error?.message ?? `Request failed (${response.status}).`, response.status, error?.fieldErrors);
  }
  return body.data;
}

/** React Admin sorts by the field names it shows; the database sorts by its own. Anything unmapped falls back. */
const USER_SORT_FIELDS: Record<string, (typeof ADMIN_USER_SORTS)[number]> = {
  createdAt: "created_at",
  lastSignInAt: "last_sign_in_at",
  adminSince: "admin_since",
  email: "email",
  displayName: "display_name",
  deckCount: "deck_count",
  collectionCount: "collection_count",
};

const TAG_SORT_FIELDS: Record<string, AdminTagSort> = {
  cardCount: "card_count",
  label: "label",
  slug: "slug",
  idf: "idf",
  disabledAt: "disabled_at",
};

type ListParams = GetListParams | GetManyReferenceParams;

/** Paging and direction, shared by every list. */
function pageQuery(params: ListParams): URLSearchParams {
  const { page = 1, perPage = DEFAULT_PER_PAGE } = params.pagination ?? {};
  return new URLSearchParams({
    order: params.sort?.order === "ASC" ? "ASC" : "DESC",
    offset: String((page - 1) * perPage),
    limit: String(perPage),
  });
}

const searchText = (params: ListParams) => (typeof params.filter?.q === "string" ? params.filter.q.trim() : "");
const filterText = (params: ListParams, key: string) => {
  const value: unknown = params.filter?.[key];
  return typeof value === "string" && value !== "" ? value : null;
};

const recordUrl = (base: string, id: unknown) => `${base}/${encodeURIComponent(String(id))}`;

/** One resource's endpoints, so the provider below is a dispatcher and each resource says only what differs. */
interface ResourceApi {
  list(resource: string, params: ListParams): Promise<{ data: RaRecord[]; total: number }>;
  one(id: unknown): Promise<RaRecord>;
  update(id: unknown, data: Record<string, unknown>, previous: Record<string, unknown> | undefined): Promise<RaRecord>;
  remove(id: unknown): Promise<RaRecord>;
}

const refuse =
  (message: string) =>
  async (): Promise<never> => {
    throw new HttpError(message, 400);
  };

const users: ResourceApi = {
  async list(resource, params) {
    const query = pageQuery(params);
    query.set("sort", USER_SORT_FIELDS[params.sort?.field ?? ""] ?? "created_at");
    const search = searchText(params);
    if (search) query.set("q", search);
    if (resource === "platform-admins" || params.filter?.adminsOnly === true) query.set("adminsOnly", "1");
    const page = await call<AdminUserPage>(`${USERS}?${query}`);
    return { data: page.users, total: page.total };
  },
  one: (id) => call<AdminUser>(recordUrl(USERS, id)),
  update: (id, data, previous) =>
    call<AdminUser>(recordUrl(USERS, id), {
      method: "PATCH",
      body: JSON.stringify(changedUserFields(data as Partial<AdminUser>, previous as Partial<AdminUser> | undefined)),
    }),
  remove: (id) => call<AdminUser>(recordUrl(USERS, id), { method: "DELETE" }),
};

const tags: ResourceApi = {
  async list(_resource, params) {
    const query = pageQuery(params);
    query.set("sort", TAG_SORT_FIELDS[params.sort?.field ?? ""] ?? "card_count");
    const search = searchText(params);
    if (search) query.set("q", search);
    if (params.filter?.disabledOnly === true) query.set("disabledOnly", "1");
    if (params.filter?.functionalOnly === true) query.set("functionalOnly", "1");
    const page = await call<AdminTagPage>(`${TAGS}?${query}`);
    return { data: page.tags, total: page.total };
  },
  one: (id) => call<AdminTag>(recordUrl(TAGS, id)),
  // The switch travels every time; the reason only matters while the tag is off, and the database drops it otherwise.
  update: (id, data) => {
    const disabled = Boolean(data.disabled);
    const disabledReason = disabled ? emptyToNull(data.disabledReason as string | null | undefined) : null;
    return call<AdminTag>(recordUrl(TAGS, id), { method: "PATCH", body: JSON.stringify({ disabled, disabledReason }) });
  },
  remove: refuse("Tags come from Scryfall Tagger. Switch one off instead of deleting it."),
};

const syncRuns: ResourceApi = {
  async list(_resource, params) {
    const query = pageQuery(params);
    const job = filterText(params, "job");
    const status = filterText(params, "status");
    if (job) query.set("job", job);
    if (status) query.set("status", status);
    const page = await call<AdminSyncRunPage>(`${SYNC_RUNS}?${query}`);
    return { data: page.runs, total: page.total };
  },
  one: (id) => call<AdminSyncRun>(recordUrl(SYNC_RUNS, id)),
  update: refuse("Sync runs are written by the worker and can't be changed here."),
  remove: refuse("Sync runs are the worker's history and can't be deleted here."),
};

const RESOURCES: Record<string, ResourceApi> = {
  users,
  "platform-admins": users,
  tags,
  "sync-runs": syncRuns,
};

function api(resource: string): ResourceApi {
  const found = RESOURCES[resource];
  if (!found) throw new HttpError(`Unknown admin resource: ${resource}.`, 404);
  return found;
}

const provider = {
  getList: (resource: string, params: GetListParams) => api(resource).list(resource, params),
  getManyReference: (resource: string, params: GetManyReferenceParams) => api(resource).list(resource, params),

  async getOne(resource: string, params: { id: unknown }) {
    return { data: await api(resource).one(params.id) };
  },

  // Used by reference fields; the list endpoints have no "several ids" mode, so this asks for each in turn. Admin
  // pages show a handful of records at a time, so the round trips are affordable and the endpoints stay simple.
  async getMany(resource: string, params: { ids: unknown[] }) {
    return { data: await Promise.all(params.ids.map((id) => api(resource).one(id))) };
  },

  async update(resource: string, params: { id: unknown; data: Record<string, unknown>; previousData?: Record<string, unknown> }) {
    return { data: await api(resource).update(params.id, params.data, params.previousData) };
  },

  async updateMany(resource: string, params: { ids: unknown[]; data: Record<string, unknown> }) {
    for (const id of params.ids) await api(resource).update(id, params.data, undefined);
    return { data: params.ids };
  },

  async delete(resource: string, params: { id: unknown }) {
    return { data: await api(resource).remove(params.id) };
  },

  async deleteMany(resource: string, params: { ids: unknown[] }) {
    for (const id of params.ids) await api(resource).remove(id);
    return { data: params.ids };
  },

  // Accounts are created by signing up, tags by Tagger and runs by the worker: nothing here is made by hand. React
  // Admin needs the method to exist, so it says so rather than half-working.
  async create() {
    throw new HttpError("Nothing in the admin area is created by hand.", 400);
  },
};

/**
 * One cast, at the boundary. `DataProvider`'s methods are generic in the record type, so a provider that returns
 * concrete record types can't satisfy them structurally — every real-world provider casts here. The per-resource
 * types above are the ones that matter.
 */
export const adminDataProvider = provider as unknown as DataProvider;

/**
 * Only what the form actually changed. The API applies the fields it is given and leaves the rest alone, so sending
 * the whole record back would let one admin's stale form undo another's edit.
 */
function changedUserFields(next: Partial<AdminUser>, previous: Partial<AdminUser> | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const changed = <K extends keyof AdminUser>(key: K) => previous === undefined || next[key] !== previous[key];

  if (changed("displayName")) body.displayName = emptyToNull(next.displayName);
  if (changed("banned")) body.banned = Boolean(next.banned);
  // The note lives on the platform_admins row, so it only travels with a grant: editing the note of somebody who is
  // still an admin is a re-grant with new text, and clearing the toggle drops the row and the note with it.
  if (changed("isAdmin") || (next.isAdmin && changed("adminNote"))) {
    body.isAdmin = Boolean(next.isAdmin);
    if (next.isAdmin) body.adminNote = emptyToNull(next.adminNote);
  }
  return body;
}

const emptyToNull = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};
