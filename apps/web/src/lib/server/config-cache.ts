/**
 * Settings the recommendation path reads on every request (app_config values, a few tag labels), kept per server
 * instance for a minute so a request's reads can all go out at once instead of waiting on these first (T055). An admin's
 * change shows within the minute. Keep `next/cache` out of this file: scripts run it outside Next.js.
 */

/** How long one server instance reuses a setting before reading it again. */
const CONFIG_TTL_MS = 60_000;

const entries = new Map<string, { value: Promise<unknown>; loadedAt: number }>();

/**
 * The value under `key`, loaded at most once a minute per instance. Concurrent callers share one read, and a read that
 * fails isn't kept, so the next caller tries again.
 */
export function cachedConfig<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.loadedAt < CONFIG_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { value, loadedAt: Date.now() });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Drops every cached setting, so a script that changes one sees it at once. */
export function clearConfigCache(): void {
  entries.clear();
}
