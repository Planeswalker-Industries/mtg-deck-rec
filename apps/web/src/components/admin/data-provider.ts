"use client";

import type { DataProvider, GetListParams, GetManyReferenceParams } from "react-admin";
import { HttpError } from "react-admin";
import { ADMIN_USER_SORTS, type AdminUser, type AdminUserPage } from "@/lib/admin/types";

/**
 * React Admin talks to our own /api/admin routes, not to Supabase directly.
 *
 * Why not `ra-supabase` and PostgREST from the browser: the admin list joins `auth.users`, which no API role can read,
 * and every admin write is a security-definer function with guards rather than a table update. Routing through the app
 * keeps all of that server-side, keeps the session in the same http-only cookies the rest of the site uses, and means
 * the admin bundle carries no Supabase credentials or query building at all.
 *
 * Both resources are the same list: `platform-admins` is `users` with the admins-only filter pinned on, so the menu
 * can offer "who has access" without a second endpoint to keep in step.
 */

const BASE = "/api/admin/users";

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
const SORT_FIELDS: Record<string, (typeof ADMIN_USER_SORTS)[number]> = {
  createdAt: "created_at",
  lastSignInAt: "last_sign_in_at",
  adminSince: "admin_since",
  email: "email",
  displayName: "display_name",
  deckCount: "deck_count",
  collectionCount: "collection_count",
};

function listQuery(resource: string, params: GetListParams | GetManyReferenceParams): string {
  const { page = 1, perPage = 25 } = params.pagination ?? {};
  const search = typeof params.filter?.q === "string" ? params.filter.q.trim() : "";
  const query = new URLSearchParams({
    sort: SORT_FIELDS[params.sort?.field ?? ""] ?? "created_at",
    order: params.sort?.order === "ASC" ? "ASC" : "DESC",
    offset: String((page - 1) * perPage),
    limit: String(perPage),
  });
  if (search) query.set("q", search);
  if (resource === "platform-admins" || params.filter?.adminsOnly === true) query.set("adminsOnly", "1");
  return `${BASE}?${query}`;
}

const one = (id: unknown) => `${BASE}/${encodeURIComponent(String(id))}`;

async function getList(resource: string, params: GetListParams | GetManyReferenceParams) {
  const page = await call<AdminUserPage>(listQuery(resource, params));
  return { data: page.users, total: page.total };
}

async function updateOne(id: unknown, data: Partial<AdminUser>, previousData: Partial<AdminUser> | undefined) {
  return { data: await call<AdminUser>(one(id), { method: "PATCH", body: JSON.stringify(changedFields(data, previousData)) }) };
}

async function deleteOne(id: unknown) {
  return { data: await call<AdminUser>(one(id), { method: "DELETE" }) };
}

const provider = {
  getList,
  getManyReference: getList,

  async getOne(_resource: string, params: { id: unknown }) {
    return { data: await call<AdminUser>(one(params.id)) };
  },

  // Used by reference fields; the list endpoint has no "several ids" mode, so this asks for each in turn. Admin
  // pages show a handful of records at a time, so the round trips are affordable and the endpoint stays simple.
  async getMany(_resource: string, params: { ids: unknown[] }) {
    return { data: await Promise.all(params.ids.map((id) => call<AdminUser>(one(id)))) };
  },

  async update(_resource: string, params: { id: unknown; data: Partial<AdminUser>; previousData?: Partial<AdminUser> }) {
    return updateOne(params.id, params.data, params.previousData);
  },

  async updateMany(_resource: string, params: { ids: unknown[]; data: Partial<AdminUser> }) {
    for (const id of params.ids) await updateOne(id, params.data, undefined);
    return { data: params.ids };
  },

  async delete(_resource: string, params: { id: unknown }) {
    return deleteOne(params.id);
  },

  async deleteMany(_resource: string, params: { ids: unknown[] }) {
    for (const id of params.ids) await deleteOne(id);
    return { data: params.ids };
  },

  // Accounts are created by signing up, never by an admin: there is no password to set here and an invite flow is a
  // different feature. React Admin needs the method to exist, so it says so rather than half-working.
  async create() {
    throw new HttpError("Accounts are created by signing up, not from the admin area.", 400);
  },
};

/**
 * One cast, at the boundary. `DataProvider`'s methods are generic in the record type, so a provider that returns one
 * concrete record type can't satisfy them structurally — every real-world provider casts here. The types above are
 * the ones that matter: everything inside this file is checked against `AdminUser`.
 */
export const adminDataProvider = provider as unknown as DataProvider;

/**
 * Only what the form actually changed. The API applies the fields it is given and leaves the rest alone, so sending
 * the whole record back would let one admin's stale form undo another's edit.
 */
function changedFields(next: Partial<AdminUser>, previous: Partial<AdminUser> | undefined): Record<string, unknown> {
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
