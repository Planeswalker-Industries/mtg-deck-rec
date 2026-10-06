import postgres from 'postgres';

/** Local Supabase (supabase/config.toml → [db] port). Point at another database with DATABASE_URL. */
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

/**
 * How long one worker statement may run. A full rebuild writes over a million rows in one statement, past the 2 minutes
 * Supabase sets by default, and its pooler drops a timeout sent when connecting, so `reserve` sets it per session.
 */
const WORKER_STATEMENT_TIMEOUT = '30min';

export function connect() {
  return postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
}

export type Sql = ReturnType<typeof connect>;
export type ReservedSql = Awaited<ReturnType<Sql['reserve']>>;

/** One connection for a job's staged work, with the worker's statement timeout in place of the database default. */
export async function reserve(sql: Sql): Promise<ReservedSql> {
  const db = await sql.reserve();
  await db`select set_config('statement_timeout', ${WORKER_STATEMENT_TIMEOUT}, false)`;
  return db;
}
