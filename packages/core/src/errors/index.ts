/**
 * The pure half of error tickets (see supabase/migrations/20261125000100_error_tickets.sql): what an error looks like
 * once it's written down, and which failures count as the same one. The web app's logger and its admin page use it;
 * the hashing itself happens on the server.
 */

/** Matching error_tickets.area's check. */
export const MAX_ERROR_AREA_CHARS = 120;
/** Matching error_tickets.code's check. */
export const MAX_ERROR_CODE_CHARS = 60;
/** Matching error_tickets.message's and error_events.message's checks. */
export const MAX_ERROR_MESSAGE_CHARS = 2_000;
/** Matching the page_path checks: the same bound feedback reports use. */
export const MAX_ERROR_PATH_CHARS = 500;
/** Matching error_events.detail's check, in bytes of its JSON text. */
export const MAX_ERROR_DETAIL_BYTES = 16_000;
/** A stack keeps its top frames: the ones that say where it broke. */
export const MAX_ERROR_STACK_CHARS = 6_000;
/** An error's class name. Longer than any real one. */
export const MAX_ERROR_NAME_CHARS = 100;
/** Context is a few facts, not a dump: this many keys at most. */
export const MAX_ERROR_CONTEXT_KEYS = 20;
export const MAX_ERROR_CONTEXT_KEY_CHARS = 40;
export const MAX_ERROR_CONTEXT_VALUE_CHARS = 500;
/** How deep `cause` chains are followed. A wrapped database error is two deep; three leaves room. */
const MAX_CAUSE_DEPTH = 3;
/** A cause's message and stack are shorter than the error's own: the top error already says most of it. */
const MAX_CAUSE_STACK_CHARS = 2_000;

/** An area is a dotted name, so tickets group and read the same way wherever they come from. */
export const ERROR_AREA_PATTERN = /^[A-Za-z0-9_.:/[\]-]+$/;

export type ErrorLevel = 'error' | 'warning';
export type ErrorSource = 'server' | 'client';
export type ErrorContext = Record<string, string | number | boolean | null>;

/** An error written down: JSON-safe, bounded, with its causes. */
export interface DescribedError {
  name: string;
  message: string;
  stack?: string;
  /** Next's id for a server error, which the browser's error page shows too. */
  digest?: string;
  /** A database or API error's own code (a Postgres SQLSTATE, a PostgREST code). */
  code?: string;
  details?: string;
  hint?: string;
  causes?: DescribedError[];
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (field === undefined || field === null || field === '') return undefined;
  return typeof field === 'string' ? field : String(field);
}

function describeOne(err: unknown, stackMax: number): DescribedError {
  if (err instanceof Error) {
    const described: DescribedError = {
      name: truncate(err.name || 'Error', MAX_ERROR_NAME_CHARS),
      message: truncate(err.message || '(no message)', MAX_ERROR_MESSAGE_CHARS),
    };
    if (err.stack) described.stack = truncate(err.stack, stackMax);
    for (const key of ['digest', 'code', 'details', 'hint'] as const) {
      const value = stringField(err, key);
      if (value) described[key] = truncate(value, MAX_ERROR_CONTEXT_VALUE_CHARS);
    }
    return described;
  }
  // A plain object, as Supabase and PostgREST return their errors: keep its message, code, details and hint.
  if (typeof err === 'object' && err !== null) {
    const message = stringField(err, 'message');
    const described: DescribedError = {
      name: truncate(stringField(err, 'name') ?? 'NonError', MAX_ERROR_NAME_CHARS),
      message: truncate(message ?? safeJson(err), MAX_ERROR_MESSAGE_CHARS),
    };
    for (const key of ['code', 'details', 'hint'] as const) {
      const value = stringField(err, key);
      if (value) described[key] = truncate(value, MAX_ERROR_CONTEXT_VALUE_CHARS);
    }
    return described;
  }
  return { name: 'NonError', message: truncate(String(err) || '(no message)', MAX_ERROR_MESSAGE_CHARS) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Any thrown value, written down with up to three causes. Never throws. */
export function describeError(err: unknown): DescribedError {
  const top = describeOne(err, MAX_ERROR_STACK_CHARS);
  const causes: DescribedError[] = [];
  let cause = err instanceof Error ? err.cause : undefined;
  while (cause !== undefined && causes.length < MAX_CAUSE_DEPTH) {
    causes.push(describeOne(cause, MAX_CAUSE_STACK_CHARS));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  if (causes.length > 0) top.causes = causes;
  return top;
}

/**
 * Context with only what fits a ticket: at most MAX_ERROR_CONTEXT_KEYS scalar facts, strings cut short. Anything
 * else (objects, arrays, functions) is dropped rather than flattened, so a deck or a collection can't slip in.
 */
export function boundContext(context: Record<string, unknown> | undefined): ErrorContext | undefined {
  if (!context) return undefined;
  const bounded: ErrorContext = {};
  let kept = 0;
  for (const [key, value] of Object.entries(context)) {
    if (kept >= MAX_ERROR_CONTEXT_KEYS) break;
    const name = truncate(key, MAX_ERROR_CONTEXT_KEY_CHARS);
    if (value === null || typeof value === 'boolean') bounded[name] = value;
    else if (typeof value === 'number') bounded[name] = Number.isFinite(value) ? value : String(value);
    else if (typeof value === 'string') bounded[name] = truncate(value, MAX_ERROR_CONTEXT_VALUE_CHARS);
    else continue;
    kept += 1;
  }
  return kept > 0 ? bounded : undefined;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi;
const QUOTED = /"[^"]*"|'[^']*'|`[^`]*`/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const URL_QUERY = /\?[^\s]*/g;

/**
 * A message with the parts that change between occurrences taken out (ids, numbers, quoted values, query strings), so
 * "import 52 failed" and "import 53 failed" are one failure. The ticket keeps the real message.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(URL_QUERY, '?…')
    .replace(UUID, '<id>')
    .replace(QUOTED, '<value>')
    .replace(LONG_HEX, '<hex>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * What a ticket's fingerprint hashes: where it came from, what was running, the code and the message's shape. Not
 * the level, so a warning that turns into an error stays one ticket, and not the page, so one broken call reached from
 * several pages is one ticket too.
 */
export function errorFingerprintSource(input: { source: ErrorSource; area: string; code?: string | null; message: string }): string {
  return [input.source, input.area, input.code ?? '', normalizeErrorMessage(input.message)].join('|');
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Text with email addresses taken out. A ticket never holds one, whatever the error said: an auth error can quote the
 * address it refused, and /privacy promises admins never see a player's email beside what they sent.
 */
export function redactPersonalData(text: string): string {
  return text.replace(EMAIL, '<email>');
}

/** A site path without its query string or fragment, or undefined when it isn't one. */
export function sitePath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let path = value;
  if (!path.startsWith('/')) {
    try {
      path = new URL(path).pathname;
    } catch {
      return undefined;
    }
  }
  path = path.split(/[?#]/, 1)[0] ?? '';
  // `//host` is a URL with no scheme, not a path on this site.
  if (!path.startsWith('/') || path.startsWith('//') || /\s/.test(path)) return undefined;
  return truncate(path, MAX_ERROR_PATH_CHARS);
}

/**
 * Detail that fits error_events.detail's size check: drops the bulkiest parts first (causes' stacks, then the stack,
 * then the causes, then the context), and as a last resort keeps only a note that it was cut.
 */
export function fitErrorDetail<T extends Record<string, unknown>>(detail: T): Record<string, unknown> {
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  if (size(detail) <= MAX_ERROR_DETAIL_BYTES) return detail;
  const trimmed: Record<string, unknown> = structuredClone(detail);
  const error = trimmed.error as DescribedError | undefined;
  const steps: (() => void)[] = [
    () => error?.causes?.forEach((c) => delete c.stack),
    () => error && delete error.stack,
    () => error && delete error.causes,
    () => delete trimmed.context,
    () => delete trimmed.request,
  ];
  for (const step of steps) {
    step();
    trimmed.truncated = true;
    if (size(trimmed) <= MAX_ERROR_DETAIL_BYTES) return trimmed;
  }
  return { truncated: true };
}
