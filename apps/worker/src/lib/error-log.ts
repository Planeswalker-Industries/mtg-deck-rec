import { createHash } from 'node:crypto';
import {
  errorFingerprintSource,
  MAX_ERROR_AREA_CHARS,
  MAX_ERROR_CODE_CHARS,
  MAX_ERROR_MESSAGE_CHARS,
  type ErrorSource,
} from '@mtg/core/errors';
import type { ReservedSql } from './db';

/** The worker runs on the server, so its tickets are server tickets, as the web app's server errors are. */
const WORKER_ERROR_SOURCE: ErrorSource = 'server';

export interface WorkerError {
  level: 'error' | 'warning';
  /** Dotted, under `worker.` (e.g. `worker.search.alias_repaired`). */
  area: string;
  code?: string;
  message: string;
  /** Plain facts only: names, ids, counts. */
  detail?: Record<string, unknown>;
}

/**
 * Adds a failure to its ticket on /admin/errors through public.log_error_event, with the fingerprint the web app
 * would give it (apps/web/src/lib/server/error-log.ts). The worker connects as the database owner, so it calls the
 * function directly. Never throws: a ticket that can't be written is a warning in the log, never a failed job.
 */
export async function logWorkerError(sql: ReservedSql, entry: WorkerError): Promise<void> {
  try {
    const area = entry.area.slice(0, MAX_ERROR_AREA_CHARS);
    const code = entry.code ? entry.code.slice(0, MAX_ERROR_CODE_CHARS) : null;
    const message = entry.message.slice(0, MAX_ERROR_MESSAGE_CHARS);
    const fingerprint = createHash('sha256')
      .update(errorFingerprintSource({ source: WORKER_ERROR_SOURCE, area, code, message }))
      .digest('hex');
    await sql`
      select public.log_error_event(
        p_fingerprint => ${fingerprint},
        p_level => ${entry.level},
        p_source => ${WORKER_ERROR_SOURCE},
        p_area => ${area},
        p_message => ${message},
        p_code => ${code},
        p_detail => ${sql.json((entry.detail ?? {}) as never)}
      )`;
  } catch (err) {
    console.warn(`Could not open a ticket for ${entry.area}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
