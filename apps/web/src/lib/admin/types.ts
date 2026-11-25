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

/** A deck search is an id or a commander name; longer than this is not either of those. */
export const MAX_ADMIN_SEARCH_CHARS = 80;

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

/** The lists the accept rate covers (T065), as `rec_events.mode` holds them. */
export const ADMIN_REC_MODES = ["add", "cut", "swap", "build"] as const;
export type AdminRecMode = (typeof ADMIN_REC_MODES)[number];

/** The windows the accept-rate page offers, in days. */
export const ADMIN_ACCEPT_RATE_DAYS = [7, 30, 90] as const;

/** One place in one kind of list: how often it was shown, taken and passed on (`admin_rec_accept_rates`). */
export interface AdminAcceptRate {
  /** `<mode>:<position>`, for React Admin. */
  id: string;
  mode: AdminRecMode;
  /** 0 first. */
  position: number;
  shown: number;
  accepted: number;
  declined: number;
  /** accepted / shown; null when nothing was shown there. */
  acceptRate: number | null;
}

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
  "edhrec_stats",
  "spellbook_combos",
  "corpus_collate",
  "edhrec_pages",
  "precompute_commanders",
  "precompute_baseline",
  "precompute_scores",
  "precompute_substitutes",
  "precompute_roles",
  "precompute_combos",
  "precompute_pairs",
  "precompute_global_pairs",
] as const;

export const ADMIN_SYNC_STATUSES = ["running", "succeeded", "skipped_unchanged", "failed", "failed_sanity", "abandoned"] as const;

export type AdminSyncJob = (typeof ADMIN_SYNC_JOBS)[number];
export type AdminSyncStatus = (typeof ADMIN_SYNC_STATUSES)[number];

/**
 * The crawled deck corpus, for the operations page at /admin/crawls.
 *
 * These are third-party decklists. They are aggregate-only everywhere else in the app and reachable here solely by a
 * platform admin, through security-definer functions that check `auth.uid()` themselves — `corpus` stays off
 * PostgREST's exposed schema list. See the hard constraints in CLAUDE.md.
 */
export interface AdminCrawlSource {
  source: string;
  decks: number;
  lastFetchedAt: string | null;
  disabled: boolean;
  disabledReason: string | null;
  probeOkAt: string | null;
  /** Non-null while a run holds the claim. */
  runningRunId: number | null;
  claimedAt: string | null;
  lastRun: {
    id: number;
    state: string;
    startedAt: string;
    finishedAt: string | null;
    decksWritten: number;
    error: string | null;
  } | null;
}

export interface AdminCrawledDeck {
  id: number;
  source: string;
  sourceDeckId: string;
  /** Resolved in the database: the stored oracle ids mean nothing on screen. */
  commanderNames: string[];
  deckSize: number;
  /** Keys in the cards object, so lower than deckSize wherever a deck runs basics. */
  distinctCards: number;
  listedUpdatedAt: string;
  lastUpdatedAt: string;
  fetchedAt: string;
  contentHash: string;
}

export interface AdminCrawledDeckPage {
  decks: AdminCrawledDeck[];
  total: number;
}

export interface AdminCrawledDeckCard {
  oracleId: string;
  /** Null when the catalog has no card for this oracle id — worth seeing rather than hiding. */
  name: string | null;
  typeLine: string | null;
  quantity: number;
}

/**
 * Feedback reports, for /admin/reports (T077). The sender is left out on purpose: admins read what was said and where,
 * not who said it (owner, 2026-11-16).
 */
export interface AdminFeedbackReport {
  id: number;
  message: string;
  /** The site path the report was sent from. */
  pagePath: string;
  createdAt: string;
  /** Null while the report is open. */
  resolvedAt: string | null;
}

export interface AdminFeedbackReportPage {
  reports: AdminFeedbackReport[];
  total: number;
}

/**
 * Error tickets, for /admin/errors: one per kind of failure, with every time it happened (the newest kept). Unlike a
 * feedback report, an event names the account it happened to, by id only, so its data can be looked at; never by email.
 */
export interface AdminErrorTicket {
  id: number;
  level: "error" | "warning";
  /** Where it was caught: the server, or a visitor's browser (whose reports the server can't vouch for). */
  source: "server" | "client";
  /** What was running: 'collection.saveBatch', 'render:/deck/page'. */
  area: string;
  code: string | null;
  /** The newest occurrence's message. */
  message: string;
  /** The newest occurrence's page, when it had one. */
  pagePath: string | null;
  occurrences: number;
  /** Signed-in accounts among the kept events: a floor, since older events are dropped. */
  accounts: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The resolved ticket this failure came back after, if any. */
  recurrenceOf: number | null;
  /** Null while the ticket is open. */
  resolvedAt: string | null;
}

export interface AdminErrorTicketPage {
  tickets: AdminErrorTicket[];
  total: number;
}

/** One time a ticket's failure happened, in full. */
export interface AdminErrorEvent {
  id: number;
  occurredAt: string;
  /** The account signed in at the time, or null. */
  userId: string | null;
  pagePath: string | null;
  message: string;
  /** The stack and causes (`error`), what the visitor saw (`shown`), `context`, `request` and `deployment`. */
  detail: Record<string, unknown>;
}
