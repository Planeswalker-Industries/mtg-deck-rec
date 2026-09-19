import type { ApiError } from "@mtg/core/contract";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListAdminUsersInput, UpdateAdminUserInput } from "@/lib/admin/schemas";
import type { AdminUser, AdminUserPage } from "@/lib/admin/types";
import { createAuthClient, getCurrentUser, type CurrentUser } from "./auth";
import type { Database } from "./database.types";

type AuthedClient = SupabaseClient<Database>;

/**
 * The admin area's server side. Everything here runs as the *visitor*, not as the service role: `is_platform_admin()`
 * and the `admin_*` functions check `auth.uid()` themselves, so the secret key is never involved and a stolen
 * deployment environment buys nobody admin access. The check below is a second lock on the same door — the database
 * is the one that has to hold.
 */

export interface AdminSession {
  db: AuthedClient;
  user: CurrentUser;
}

/**
 * The signed-in platform admin, or the error to return.
 *
 * A signed-in non-admin gets NOT_FOUND rather than a refusal: the admin area answers exactly as if it did not exist,
 * so its presence can't be confirmed by poking at it. `proxy.ts` rewrites /admin the same way, for the same reason.
 */
export async function requirePlatformAdmin(): Promise<AdminSession | { error: ApiError }> {
  const user = await getCurrentUser();
  if (!user) return { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } };

  const db = await createAuthClient();
  const { data, error } = await db.rpc("is_platform_admin", { p_user: user.id });
  if (error) {
    console.error(`Checking platform admin for ${user.id} failed: ${error.message}`);
    return { error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't check your access. Try again in a moment." } };
  }
  if (!data) return { error: { code: "NOT_FOUND", message: "Not found." } };
  return { db, user };
}

/** Whether the signed-in visitor may reach /admin. For pages and nav links; the API uses requirePlatformAdmin. */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await requirePlatformAdmin();
  return !("error" in session);
}

export async function listAdminUsers(db: AuthedClient, input: ListAdminUsersInput): Promise<AdminUserPage> {
  const { data, error } = await db.rpc("admin_list_users", {
    p_user_id: input.userId,
    p_search: input.search,
    p_admins_only: input.adminsOnly,
    p_sort: input.sort,
    p_ascending: input.ascending,
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);

  const rows = data ?? [];
  const first = rows[0];
  return {
    users: rows.map(toAdminUser),
    // Every row carries the same window count; with no rows there is nothing to page through.
    total: first ? Number(first.total_count) : 0,
  };
}

export async function getAdminUser(db: AuthedClient, id: string): Promise<AdminUser | null> {
  const { users } = await listAdminUsers(db, { userId: id, adminsOnly: false, sort: "created_at", ascending: false, offset: 0, limit: 1 });
  return users[0] ?? null;
}

/**
 * Applies only the fields the caller sent, one database function per kind of change, so each keeps its own guard and
 * writes its own audit row. Admin membership is applied last: banning or renaming an account that is about to lose
 * admin should not be refused by the "revoke first" rule on the way through.
 */
export async function updateAdminUser(db: AuthedClient, id: string, input: UpdateAdminUserInput): Promise<void> {
  if (input.displayName !== undefined) {
    const { error } = await db.rpc("admin_set_display_name", { p_user_id: id, p_display_name: input.displayName ?? "" });
    if (error) throw asAdminError(error);
  }
  if (input.isAdmin !== undefined) {
    const { error } = await db.rpc("admin_set_platform_admin", {
      p_user_id: id,
      p_is_admin: input.isAdmin,
      ...(input.adminNote == null ? {} : { p_note: input.adminNote }),
    });
    if (error) throw asAdminError(error);
  }
  if (input.banned !== undefined) {
    const { error } = await db.rpc("admin_set_user_banned", { p_user_id: id, p_banned: input.banned });
    if (error) throw asAdminError(error);
  }
}

export async function deleteAdminUser(db: AuthedClient, id: string): Promise<void> {
  const { error } = await db.rpc("admin_delete_user", { p_user_id: id });
  if (error) throw asAdminError(error);
}

/**
 * A guard the database raised, carried up with the message it chose. Those messages are written for the admin reading
 * them ("Remove platform admin access before deleting this account."), so they are shown rather than swallowed.
 */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly code: ApiError["code"],
  ) {
    super(message);
    this.name = "AdminError";
  }
}

interface PostgrestError {
  code?: string;
  message: string;
}

function asAdminError(error: PostgrestError): Error {
  switch (error.code) {
    // insufficient_privilege: the caller lost admin between the guard and the call.
    case "42501":
      return new AdminError("Not found.", "NOT_FOUND");
    // no_data_found: the account is already gone.
    case "P0002":
      return new AdminError(error.message, "NOT_FOUND");
    // check_violation: one of the rules the functions enforce, phrased for a person.
    case "23514":
      return new AdminError(error.message, "VALIDATION");
    default:
      console.error(`Admin call failed (${error.code ?? "no code"}): ${error.message}`);
      return new AdminError("That didn't work. Try again in a moment.", "UPSTREAM_UNAVAILABLE");
  }
}

function toAdminUser(row: Database["public"]["Functions"]["admin_list_users"]["Returns"][number]): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isAdmin: row.is_admin,
    adminNote: row.admin_note,
    adminSince: row.admin_since,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    emailConfirmedAt: row.email_confirmed_at,
    banned: row.banned_until != null && Date.parse(row.banned_until) > Date.now(),
    bannedUntil: row.banned_until,
    deckCount: row.deck_count,
    collectionCount: row.collection_count,
  };
}
