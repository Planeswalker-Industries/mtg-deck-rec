import type { SyncJob } from './sync-runs';

type CacheTag = 'catalog' | 'corpus' | 'recs';

/** Web app cache tags whose data each job changes (apps/web/src/lib/server/recs-cache.ts assigns them). */
const TAGS_BY_JOB: Record<SyncJob, CacheTag[]> = {
  scryfall_catalog: ['catalog', 'recs'],
  scryfall_printings: ['catalog', 'recs'],
  oracle_tags: ['catalog', 'recs'],
  corpus_aggregate: ['corpus', 'recs'],
  corpus_collate: [], // nothing the web app caches reads corpus; the aggregate that follows refreshes it
  edhrec_stats: [], // the retired import:edhrec; kept for its run history
  edhrec_pages: [], // raw: nothing the web app caches reads it
  spellbook_combos: [], // nor this
  precompute_commanders: ['corpus', 'recs'],
  precompute_baseline: ['corpus', 'recs'],
  precompute_scores: ['corpus', 'recs'],
  precompute_substitutes: ['catalog', 'recs'], // card pages (catalog) show a card's alternatives
  precompute_roles: ['recs'],
  precompute_combos: [], // combos are read per request, never cached
  precompute_pairs: [], // so are card pairs
  precompute_global_pairs: [],
};

const TIMEOUT_MS = 10_000;

/**
 * Tells the web app that a job's committed changes make its cached pages stale. Needs WEB_APP_URL and
 * REVALIDATE_SECRET; without them it logs and does nothing, and caches expire on their own schedule. Never throws: the
 * data is already committed, so a failed refresh only delays when visitors see it.
 */
export async function refreshWebCaches(job: SyncJob): Promise<void> {
  const base = process.env.WEB_APP_URL;
  const secret = process.env.REVALIDATE_SECRET;
  const tags = TAGS_BY_JOB[job];
  if (tags.length === 0) return;
  if (!base || !secret) {
    console.log(`${job}: WEB_APP_URL or REVALIDATE_SECRET isn't set, so web caches (${tags.join(', ')}) weren't refreshed.`);
    return;
  }
  try {
    const res = await fetch(new URL('/api/internal/revalidate', base), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`${job}: refreshed web caches (${tags.join(', ')}).`);
  } catch (err) {
    console.warn(`${job}: refreshing web caches failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
