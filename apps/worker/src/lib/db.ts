import postgres from 'postgres';

/** Local Supabase (supabase/config.toml → [db] port). Point at another database with DATABASE_URL. */
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:56322/postgres';

export function connect() {
  return postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
}

export type Sql = ReturnType<typeof connect>;
export type ReservedSql = Awaited<ReturnType<Sql['reserve']>>;
