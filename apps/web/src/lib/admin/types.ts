import type { WorkerScheduleFacts } from "@mtg/core/worker";
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
  /** Journeys the account started in the deck tool, from a pasted deck or a commander's build. */
  journeyCount: number;
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
  "journey_count",
] as const;

export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];

/**
 * Field limits, kept here rather than beside the schemas so the admin UI can show them without pulling zod into the
 * browser bundle. They mirror what the database functions enforce.
 */
export const MAX_DISPLAY_NAME_CHARS = 60;
export const MAX_ADMIN_NOTE_CHARS = 200;
export const ADMIN_PER_PAGE_MAX = 200;

/** Decks listed on one account's Decks tab, all on one page. Far above any real account; `admin_user_decks` caps here. */
export const MAX_ADMIN_USER_DECKS = 500;

/** One saved deck on an account's Decks tab: public or private, because the admin is there to fix a problem. */
export interface AdminUserDeck {
  id: string;
  code: string;
  name: string;
  isPublic: boolean;
  isBuilt: boolean;
  /** Resolved on the server from the deck's commander ids; empty for a deck saved without one. */
  commanderNames: string[];
  cardCount: number;
  bracket: number | null;
  createdAt: string;
  updatedAt: string;
  /** The deck's public page. Null for a private deck: its page answers 404 to everyone but its owner. */
  path: string | null;
}

export interface AdminDeckCard {
  cardId: number;
  name: string;
  section: "commander" | "main";
  quantity: number;
}

/** Imports listed on one account's Collection tab, newest first. `admin_user_collection` caps here. */
export const MAX_ADMIN_USER_IMPORTS = 50;

/** A collection search shorter than this matches nothing: one letter would list nearly the whole collection. */
export const MIN_COLLECTION_SEARCH_CHARS = 2;

/** Entries on one page of a collection search. `admin_user_collection_items` clamps here. */
export const ADMIN_COLLECTION_PAGE = 50;

/** A collection search is part of a card name; longer than this is no card's name. */
export const MAX_COLLECTION_SEARCH_CHARS = 150;

export interface AdminCollectionImport {
  id: number;
  sourceApp: "manabox" | "moxfield" | "tcgplayer" | "generic_csv" | "generic_json" | "text";
  mode: "replace" | "merge";
  /** `open` until the player confirms the import; an open one hours old was abandoned. */
  status: "open" | "committed";
  rowsTotal: number;
  createdAt: string;
  committedAt: string | null;
}

/** One account's collection as its Collection tab shows it: totals and import history, never the entries. */
export interface AdminUserCollection {
  entries: number;
  distinctCards: number;
  totalQuantity: number;
  /** Quantity times each entry's printing price for its finish; unpriced entries add nothing. */
  valueUsd: number;
  unpricedEntries: number;
  /** When prices were last checked (`prices_checked_at()`); null before the first catalog sync. */
  pricesAsOf: string | null;
  shared: boolean;
  imports: AdminCollectionImport[];
}

export interface AdminCollectionItem {
  cardName: string;
  /** Null for an entry matched by name alone, with no printing. */
  setCode: string | null;
  collectorNumber: string | null;
  finish: "nonfoil" | "foil" | "etched";
  condition: string;
  lang: string;
  quantity: number;
}

export interface AdminCollectionItemPage {
  total: number;
  rows: AdminCollectionItem[];
}

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

/** A count with how many of it are new: "+N today · +N this week" on the admin home. */
export interface AdminWindowedCount {
  total: number;
  /** Created in the last 24 hours. */
  last24h: number;
  /** Created in the last 7 days. */
  last7d: number;
}

/** The site's numbers on the admin home, counted live on every load (`admin_site_stats`). */
export interface AdminSiteStats {
  users: AdminWindowedCount;
  decks: AdminWindowedCount & { public: number };
  /** Accounts with at least one collection entry. */
  collections: number;
  importsLast7d: number;
  /** Deck tool journeys started, signed in or not, with how they started. */
  journeys: AdminWindowedCount & { paste: number; build: number; signedIn: number };
  openReports: number;
  openErrors: number;
}

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
    /** When the run last reported progress (after its claim and after every commander); null before the first. */
    progressAt: string | null;
    commandersVisited: number;
    /** How many times the source answered 429 during the run. */
    throttles: number;
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
  /** Replies emailed to the sender, oldest first. */
  replies: AdminFeedbackReply[];
}

/**
 * A reply an admin sent to a report's sender, by email to the address on their account. The address itself never
 * reaches the admin: the server looks it up and hands it to the mail service.
 */
export interface AdminFeedbackReply {
  id: number;
  message: string;
  /** 'sending' only if the server stopped between recording the reply and hearing back from the mail service. */
  status: "sending" | "sent" | "failed";
  /** Why it wasn't sent, when it wasn't. */
  failure: string | null;
  createdAt: string;
}

export interface AdminFeedbackReportPage {
  reports: AdminFeedbackReport[];
  total: number;
  /** Whether this deployment can send email, so Reply can be offered. */
  replyEnabled: boolean;
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

/** The worker's schedule and the asks waiting for it (`admin_worker_schedule`), for the admin home's Run now. */
export interface AdminWorkerSchedule extends WorkerScheduleFacts {
  /** Run-now asks the worker hasn't taken yet: a duty, or `crawl:<source>`. */
  waiting: { duty: string; requestedAt: string }[];
}
