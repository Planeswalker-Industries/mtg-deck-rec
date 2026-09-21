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

/** A Tagger tag as the kill-switch page shows it. */
export interface AdminTag {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  /** Cards tagged with this tag or any tag beneath it. */
  cardCount: number;
  /** 0..1; broad tags score low. */
  idf: number;
  /** Whether it feeds "does the same job", so switching it off changes recommendations. */
  isFunctional: boolean;
  disabled: boolean;
  disabledReason: string | null;
  disabledByEmail: string | null;
  disabledAt: string | null;
}

export interface AdminTagPage {
  tags: AdminTag[];
  total: number;
}

/** What `admin_list_tags` will order by. Anything else falls back to the most-used tags first. */
export const ADMIN_TAG_SORTS = ["card_count", "label", "slug", "idf", "disabled_at"] as const;

export type AdminTagSort = (typeof ADMIN_TAG_SORTS)[number];

/** Mirrors the limit `admin_set_tag_disabled` enforces. */
export const MAX_TAG_REASON_CHARS = 200;

/** One run of a worker job, as the sync status page shows it. */
export interface AdminSyncRun {
  id: number;
  job: AdminSyncJob;
  status: AdminSyncStatus;
  sourceUri: string | null;
  sourceUpdatedAt: string | null;
  workerId: string;
  startedAt: string;
  heartbeatAt: string;
  finishedAt: string | null;
  rowsRead: number;
  rowsChanged: number;
  /** The counts the next run's sanity gate compares against. Shape varies by job. */
  metrics: Record<string, unknown> | null;
  error: string | null;
}

export interface AdminSyncRunPage {
  runs: AdminSyncRun[];
  total: number;
}

/** The `sync_job` and `sync_status` enums, for the filters. Kept in step with the database by the typecheck in admin.ts. */
export const ADMIN_SYNC_JOBS = [
  "scryfall_catalog",
  "scryfall_printings",
  "oracle_tags",
  "corpus_aggregate",
  "archidekt_crawl",
  "precon_import",
  "vote_aggregate",
] as const;

export const ADMIN_SYNC_STATUSES = ["running", "succeeded", "skipped_unchanged", "failed", "failed_sanity", "abandoned"] as const;

export type AdminSyncJob = (typeof ADMIN_SYNC_JOBS)[number];
export type AdminSyncStatus = (typeof ADMIN_SYNC_STATUSES)[number];
