/**
 * The admin area's own view model. It is deliberately not part of the frozen frontend/backend contract in
 * `@mtg/core/contract`: nothing public depends on these shapes, and the admin UI should be free to change without a
 * contract version bump.
 */
export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  adminNote: string | null;
  adminSince: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  /** Derived from banned_until, so the toggle in the UI is a plain boolean and the date stays for display. */
  banned: boolean;
  bannedUntil: string | null;
  deckCount: number;
  collectionCount: number;
}

export interface AdminUserPage {
  users: AdminUser[];
  total: number;
}

/** What `admin_list_users` will order by. Anything else falls back to the newest accounts first. */
export const ADMIN_USER_SORTS = [
  "created_at",
  "last_sign_in_at",
  "admin_since",
  "email",
  "display_name",
  "deck_count",
  "collection_count",
] as const;

export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

/**
 * Field limits, kept here rather than beside the schemas so the admin UI can show them without pulling zod into the
 * browser bundle. They mirror what the database functions enforce.
 */
export const MAX_DISPLAY_NAME_CHARS = 60;
export const MAX_ADMIN_NOTE_CHARS = 200;
export const ADMIN_PER_PAGE_MAX = 200;
