import type { ApiError } from "@mtg/core/contract";
import { normalizeName } from "@mtg/core/parse";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ListAdminAcceptRatesInput,
  ListAdminCrawledDecksInput,
  ListAdminErrorTicketsInput,
  ListAdminFeedbackReportsInput,
  ListAdminSyncRunsInput,
  ListAdminTagsInput,
  ListAdminUsersInput,
  SearchAdminCollectionInput,
  UpdateAdminTagInput,
  UpdateAdminUserInput,
} from "@/lib/admin/schemas";
import type {
  AdminAcceptRate,
  AdminCollectionItemPage,
  AdminCrawledDeckCard,
  AdminCrawledDeckPage,
  AdminCrawlSource,
  AdminDeckCard,
  AdminErrorEvent,
  AdminErrorTicket,
  AdminErrorTicketPage,
  AdminFeedbackReply,
  AdminFeedbackReportPage,
  AdminRecMode,
  AdminSiteStats,
  AdminSyncJob,
  AdminSyncRun,
  AdminSyncRunPage,
  AdminSyncStatus,
  AdminTag,
  AdminTagPage,
  AdminUser,
  AdminUserCollection,
  AdminUserDeck,
  AdminUserPage,
} from "@/lib/admin/types";
import { createAuthClient, getCurrentUser, type CurrentUser } from "./auth";
import { emailConfigured } from "./email";
import type { Database } from "./database.types";
import { logError } from "./error-log";

export type AuthedClient = SupabaseClient<Database>;

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
    logError({ area: "admin.check", error });
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

export function asAdminError(error: PostgrestError): Error {
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
      logError({ area: "admin.call", error, code: error.code });
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

// ---------------------------------------------------------------------------
// Tags: the kill switch
// ---------------------------------------------------------------------------

export async function listAdminTags(db: AuthedClient, input: ListAdminTagsInput): Promise<AdminTagPage> {
  const { data, error } = await db.rpc("admin_list_tags", {
    ...(input.tagId ? { p_tag_id: input.tagId } : {}),
    ...(input.search ? { p_search: input.search } : {}),
    p_disabled_only: input.disabledOnly,
    p_functional_only: input.functionalOnly,
    p_sort: input.sort,
    p_ascending: input.ascending,
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);
  const rows = data ?? [];
  return { tags: rows.map(toAdminTag), total: rows[0] ? Number(rows[0].total_count) : 0 };
}

export async function getAdminTag(db: AuthedClient, id: string): Promise<AdminTag | null> {
  const { tags } = await listAdminTags(db, {
    tagId: id,
    disabledOnly: false,
    functionalOnly: false,
    sort: "card_count",
    ascending: false,
    offset: 0,
    limit: 1,
  });
  return tags[0] ?? null;
}

/** Throws the switch. The database records who, when and why, and writes the audit row. */
export async function setAdminTagDisabled(db: AuthedClient, id: string, input: UpdateAdminTagInput): Promise<void> {
  const { error } = await db.rpc("admin_set_tag_disabled", {
    p_tag_id: id,
    p_disabled: input.disabled,
    ...(input.disabledReason ? { p_reason: input.disabledReason } : {}),
  });
  if (error) throw asAdminError(error);
}

function toAdminTag(row: Database["public"]["Functions"]["admin_list_tags"]["Returns"][number]): AdminTag {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    description: row.description,
    cardCount: row.card_count,
    idf: row.idf,
    isFunctional: row.is_functional,
    disabled: row.disabled,
    disabledReason: row.disabled_reason,
    disabledByEmail: row.disabled_by_email,
    disabledAt: row.disabled_at,
  };
}

// ---------------------------------------------------------------------------
// Sync runs
// ---------------------------------------------------------------------------

type DbSyncJob = Database["public"]["Enums"]["sync_job"];
type DbSyncStatus = Database["public"]["Enums"]["sync_status"];

/**
 * Compile-time proof that the filter lists in `lib/admin/types.ts` name exactly the database's enum values: a job
 * added in a migration and missed there (or the reverse) fails the typecheck here rather than going unfilterable.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const JOBS_MATCH: Same<AdminSyncJob, DbSyncJob> = true;
const STATUSES_MATCH: Same<AdminSyncStatus, DbSyncStatus> = true;
void JOBS_MATCH;
void STATUSES_MATCH;

/** Places in a list past this aren't reported: hardly anyone looks that far down. */
const ACCEPT_RATE_MAX_POSITION = 20;

/** Accept rate per kind of list and position over the last `days` days (T065). */
export async function listAdminAcceptRates(db: AuthedClient, input: ListAdminAcceptRatesInput): Promise<AdminAcceptRate[]> {
  const { data, error } = await db.rpc("admin_rec_accept_rates", {
    p_days: input.days,
    ...(input.mode ? { p_mode: input.mode } : {}),
    p_max_position: ACCEPT_RATE_MAX_POSITION,
  });
  if (error) throw asAdminError(error);
  return (data ?? []).map((row) => {
    const shown = Number(row.shown);
    const accepted = Number(row.accepted);
    return {
      id: `${row.mode}:${row.position}`,
      mode: row.mode as AdminRecMode,
      position: row.position,
      shown,
      accepted,
      declined: Number(row.declined),
      acceptRate: shown > 0 ? accepted / shown : null,
    };
  });
}

export async function listAdminSyncRuns(db: AuthedClient, input: ListAdminSyncRunsInput): Promise<AdminSyncRunPage> {
  const { data, error } = await db.rpc("admin_list_sync_runs", {
    ...(input.runId ? { p_run_id: input.runId } : {}),
    ...(input.job ? { p_job: input.job } : {}),
    ...(input.status ? { p_status: input.status } : {}),
    p_ascending: input.ascending,
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);
  const rows = data ?? [];
  return { runs: rows.map(toAdminSyncRun), total: rows[0] ? Number(rows[0].total_count) : 0 };
}

export async function getAdminSyncRun(db: AuthedClient, id: number): Promise<AdminSyncRun | null> {
  const { runs } = await listAdminSyncRuns(db, { runId: id, ascending: false, offset: 0, limit: 1 });
  return runs[0] ?? null;
}

function toAdminSyncRun(row: Database["public"]["Functions"]["admin_list_sync_runs"]["Returns"][number]): AdminSyncRun {
  return {
    id: Number(row.id),
    job: row.job as AdminSyncJob,
    status: row.status as AdminSyncStatus,
    sourceUri: row.source_uri,
    sourceUpdatedAt: row.source_updated_at,
    workerId: row.worker_id,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
    rowsRead: Number(row.rows_read),
    rowsChanged: Number(row.rows_changed),
    metrics: isRecord(row.metrics) ? row.metrics : null,
    error: row.error,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The admin home's site numbers: accounts, decks, collections, recent imports and what is open in the inboxes. Live
 * counts on every load; each is a small table or an index read in `admin_site_stats`.
 */
export async function getAdminSiteStats(db: AuthedClient): Promise<AdminSiteStats> {
  const { data, error } = await db.rpc("admin_site_stats");
  if (error) throw asAdminError(error);
  return data as unknown as AdminSiteStats;
}

/**
 * The crawled corpus, for /admin/crawls.
 *
 * Like every other read here, this runs as the *visitor*: the three `admin_*` crawl functions check
 * `is_platform_admin()` themselves, and `corpus` is reachable no other way — it is off PostgREST's exposed schema
 * list precisely because it holds third-party decklists.
 */
export async function listAdminCrawlSources(db: AuthedClient): Promise<AdminCrawlSource[]> {
  const { data, error } = await db.rpc("admin_crawl_overview");
  if (error) throw asAdminError(error);
  return (data ?? []).map((row) => ({
    source: row.source,
    decks: Number(row.decks),
    lastFetchedAt: row.last_fetched_at,
    disabled: row.disabled,
    disabledReason: row.disabled_reason,
    probeOkAt: row.probe_ok_at,
    runningRunId: row.running_run_id === null ? null : Number(row.running_run_id),
    claimedAt: row.claimed_at,
    // A source that has never run has no last run, rather than a run full of nulls.
    lastRun:
      row.last_run_id === null
        ? null
        : {
            id: Number(row.last_run_id),
            state: row.last_run_state ?? "unknown",
            startedAt: row.last_run_started_at ?? "",
            finishedAt: row.last_run_finished_at,
            decksWritten: row.last_run_decks_written ?? 0,
            error: row.last_run_error,
            progressAt: row.last_run_progress_at,
            commandersVisited: row.last_run_commanders_visited ?? 0,
            throttles: row.last_run_throttles ?? 0,
            skippedMalformed: row.last_run_skipped_malformed ?? 0,
          },
  }));
}

export async function listAdminCrawledDecks(db: AuthedClient, input: ListAdminCrawledDecksInput): Promise<AdminCrawledDeckPage> {
  const { data, error } = await db.rpc("admin_list_crawled_decks", {
    ...(input.source ? { p_source: input.source } : {}),
    ...(input.search ? { p_search: input.search } : {}),
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);
  const rows = data ?? [];
  return {
    decks: rows.map((row) => ({
      id: Number(row.id),
      source: row.source,
      sourceDeckId: row.source_deck_id,
      commanderNames: row.commander_names ?? [],
      deckSize: row.deck_size,
      distinctCards: row.distinct_cards,
      listedUpdatedAt: row.listed_updated_at,
      lastUpdatedAt: row.last_updated_at,
      fetchedAt: row.fetched_at,
      contentHash: row.content_hash,
    })),
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

export async function getAdminCrawledDeckCards(db: AuthedClient, deckId: number): Promise<AdminCrawledDeckCard[]> {
  const { data, error } = await db.rpc("admin_crawled_deck_cards", { p_deck_id: deckId });
  if (error) throw asAdminError(error);
  return (data ?? []).map((row) => ({
    oracleId: row.oracle_id,
    name: row.name,
    typeLine: row.type_line,
    quantity: row.quantity,
  }));
}

/** The shape `admin_user_decks` returns for each deck, before commander ids become names. */
interface UserDeckRow {
  id: string;
  code: string;
  name: string;
  isPublic: boolean;
  isBuilt: boolean;
  commanderIds: number[];
  cardCount: number;
  bracket: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every deck one account saved, public or private, for the user page's Decks tab. Each call writes one audit row in
 * the database, so the tab asks only when it is opened.
 *
 * Commander names and the deck page path are resolved here, from the catalog, rather than in SQL: the path is the
 * same `/decks/<commander slug>/<code>` the rest of the app links to, and the slug segment is decoration that only
 * the app knows how to fall back on.
 */
export async function getAdminUserDecks(db: AuthedClient, userId: string): Promise<AdminUserDeck[]> {
  const { data, error } = await db.rpc("admin_user_decks", { p_user_id: userId });
  if (error) throw asAdminError(error);
  const rows = (Array.isArray(data) ? data : []) as unknown as UserDeckRow[];

  const ids = [...new Set(rows.flatMap((row) => row.commanderIds))];
  const commanders = new Map<number, { name: string; slug: string }>();
  if (ids.length > 0) {
    const { data: cards, error: cardsError } = await db.from("cards").select("id, name, slug").in("id", ids);
    if (cardsError) throw asAdminError(cardsError);
    for (const card of cards ?? []) commanders.set(card.id, { name: card.name, slug: card.slug });
  }

  return rows.map((row) => {
    const lead = commanders.get(row.commanderIds[0] ?? -1);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isPublic: row.isPublic,
      isBuilt: row.isBuilt,
      commanderNames: row.commanderIds.map((id) => commanders.get(id)?.name ?? `Card ${id}`),
      cardCount: row.cardCount,
      bracket: row.bracket,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      path: row.isPublic ? `/decks/${encodeURIComponent(lead?.slug ?? "deck")}/${encodeURIComponent(row.code)}` : null,
    };
  });
}

/** One saved deck's cards, commanders first. One audit row per call, naming the deck and its owner. */
export async function getAdminDeckCards(db: AuthedClient, deckId: string): Promise<AdminDeckCard[]> {
  const { data, error } = await db.rpc("admin_deck_cards", { p_deck_id: deckId });
  if (error) throw asAdminError(error);
  return (Array.isArray(data) ? data : []) as unknown as AdminDeckCard[];
}

/**
 * One account's collection totals and import history, for the user page's Collection tab. One audit row per call.
 * The entries themselves are reached only through a search (`searchAdminUserCollection`).
 */
export async function getAdminUserCollection(db: AuthedClient, userId: string): Promise<AdminUserCollection> {
  const { data, error } = await db.rpc("admin_user_collection", { p_user_id: userId });
  if (error) throw asAdminError(error);
  return data as unknown as AdminUserCollection;
}

/**
 * Entries of one account's collection whose card name contains the search, a page at a time. The search is
 * normalized the way `cards.name_normalized` is built, so "Seance" finds "Séance". One audit row per call, holding the
 * search's length, never its text.
 */
export async function searchAdminUserCollection(
  db: AuthedClient,
  userId: string,
  input: SearchAdminCollectionInput,
): Promise<AdminCollectionItemPage> {
  const { data, error } = await db.rpc("admin_user_collection_items", {
    p_user_id: userId,
    p_search: normalizeName(input.search),
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);
  return data as unknown as AdminCollectionItemPage;
}

export async function listAdminFeedbackReports(
  db: AuthedClient,
  input: ListAdminFeedbackReportsInput,
): Promise<AdminFeedbackReportPage> {
  const { data, error } = await db.rpc("admin_list_feedback_reports", {
    p_open_only: input.openOnly,
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);
  const rows = data ?? [];
  const replies = await feedbackReplies(
    db,
    rows.map((row) => Number(row.id)),
  );
  return {
    reports: rows.map((row) => ({
      id: Number(row.id),
      message: row.message,
      pagePath: row.page_path,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      replies: replies.get(Number(row.id)) ?? [],
    })),
    total: rows[0] ? Number(rows[0].total_count) : 0,
    replyEnabled: emailConfigured(),
  };
}

/**
 * The replies to a page of reports, by report. A failed read leaves them out rather than failing the list: a preview
 * deploy runs against main's schema, which may not have replies yet.
 */
async function feedbackReplies(db: AuthedClient, reportIds: number[]): Promise<Map<number, AdminFeedbackReply[]>> {
  const byReport = new Map<number, AdminFeedbackReply[]>();
  if (reportIds.length === 0) return byReport;
  const { data, error } = await db.rpc("admin_feedback_report_replies", { p_report_ids: reportIds });
  if (error) {
    logError({ area: "admin.feedbackReplies", error, level: "warning" });
    return byReport;
  }
  for (const row of data ?? []) {
    const reply: AdminFeedbackReply = {
      id: Number(row.id),
      message: row.message,
      status: row.status as AdminFeedbackReply["status"],
      failure: row.failure,
      createdAt: row.created_at,
    };
    const list = byReport.get(Number(row.report_id));
    if (list) list.push(reply);
    else byReport.set(Number(row.report_id), [reply]);
  }
  return byReport;
}

export async function setAdminFeedbackReportResolved(db: AuthedClient, id: number, resolved: boolean): Promise<void> {
  const { error } = await db.rpc("admin_set_feedback_report_resolved", { p_id: id, p_resolved: resolved });
  if (error) throw asAdminError(error);
}

export async function listAdminErrorTickets(db: AuthedClient, input: ListAdminErrorTicketsInput): Promise<AdminErrorTicketPage> {
  const { data, error } = await db.rpc("admin_list_error_tickets", {
    p_open_only: input.openOnly,
    p_offset: input.offset,
    p_limit: input.limit,
  });
  if (error) throw asAdminError(error);
  const rows = data ?? [];
  return {
    tickets: rows.map((row) => ({
      id: Number(row.id),
      level: row.level as AdminErrorTicket["level"],
      source: row.source as AdminErrorTicket["source"],
      area: row.area,
      code: row.code,
      message: row.message,
      pagePath: row.page_path,
      occurrences: row.occurrences,
      accounts: row.accounts,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      recurrenceOf: row.recurrence_of === null ? null : Number(row.recurrence_of),
      resolvedAt: row.resolved_at,
    })),
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

export async function getAdminErrorTicketEvents(db: AuthedClient, ticketId: number): Promise<AdminErrorEvent[]> {
  const { data, error } = await db.rpc("admin_error_ticket_events", { p_ticket_id: ticketId });
  if (error) throw asAdminError(error);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    occurredAt: row.occurred_at,
    userId: row.user_id,
    pagePath: row.page_path,
    message: row.message,
    detail: typeof row.detail === "object" && row.detail !== null && !Array.isArray(row.detail) ? (row.detail as Record<string, unknown>) : {},
  }));
}

export async function setAdminErrorTicketResolved(db: AuthedClient, id: number, resolved: boolean): Promise<void> {
  const { error } = await db.rpc("admin_set_error_ticket_resolved", { p_id: id, p_resolved: resolved });
  if (error) throw asAdminError(error);
}
