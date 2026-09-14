import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BULK_DIR } from './config';
import { politeFetch, RateLimiter } from './http';

export type BulkType =
  | 'oracle_cards'
  | 'unique_artwork'
  | 'default_cards'
  | 'all_cards'
  | 'rulings'
  | 'art_tags'
  | 'oracle_tags';

export interface BulkEntry {
  type: BulkType;
  name: string;
  updated_at: string;
  jsonl_download_uri: string;
  compressed_size: number;
}

/** api.scryfall.com asks for 50–100 ms between requests. Bulk file downloads come from the data CDN instead. */
export const scryfallApi = new RateLimiter(100);

const PREVIOUS_VERSIONS_KEPT = 1;

export async function getBulkIndex(): Promise<BulkEntry[]> {
  const res = await politeFetch('https://api.scryfall.com/bulk-data', { limiter: scryfallApi, accept: 'application/json' });
  const body = (await res.json()) as { data: BulkEntry[] };
  return body.data;
}

/** "2026-09-13T21:00:36.228+00:00" → "20260913T210036" */
const versionStamp = (updatedAt: string) => updatedAt.replace(/[-:]/g, '').replace(/\..*$/, '');

export function bulkFilePrefix(type: BulkType): string {
  return `${type}-`;
}

export async function latestBulkFile(type: BulkType): Promise<string | null> {
  const files = (await readdir(BULK_DIR).catch((): string[] => []))
    .filter((f) => f.startsWith(bulkFilePrefix(type)) && !f.endsWith('.part'))
    .sort();
  const newest = files.at(-1);
  return newest ? path.join(BULK_DIR, newest) : null;
}

export interface DownloadedBulk {
  entry: BulkEntry;
  filePath: string;
  downloaded: boolean;
  bytes: number;
}

/**
 * Downloads one bulk file into BULK_DIR, named by type and Scryfall's `updated_at`.
 * Skips the download when that version is already on disk. Writes to `.part` and renames on success,
 * so an interrupted download never looks complete. Keeps one previous version for rollback.
 */
export async function downloadBulk(entry: BulkEntry, log: (msg: string) => void = console.log): Promise<DownloadedBulk> {
  await mkdir(BULK_DIR, { recursive: true });
  const ext = new URL(entry.jsonl_download_uri).pathname.endsWith('.gz') ? '.jsonl.gz' : '.jsonl';
  const filePath = path.join(BULK_DIR, `${bulkFilePrefix(entry.type)}${versionStamp(entry.updated_at)}${ext}`);

  const existing = await stat(filePath).catch(() => null);
  if (existing && existing.size > 0) {
    log(`${entry.type}: already have ${path.basename(filePath)}`);
    return { entry, filePath, downloaded: false, bytes: existing.size };
  }

  log(`${entry.type}: downloading ~${(entry.compressed_size / 2 ** 20).toFixed(1)} MB`);
  const res = await politeFetch(entry.jsonl_download_uri, { accept: '*/*' });
  if (!res.body) throw new Error(`${entry.type}: response had no body`);

  const partPath = `${filePath}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partPath));
  const { size } = await stat(partPath);
  await rename(partPath, filePath);
  await pruneOldVersions(entry.type);

  log(`${entry.type}: saved ${(size / 2 ** 20).toFixed(1)} MB to ${filePath}`);
  return { entry, filePath, downloaded: true, bytes: size };
}

async function pruneOldVersions(type: BulkType): Promise<void> {
  const files = (await readdir(BULK_DIR))
    .filter((f) => f.startsWith(bulkFilePrefix(type)) && !f.endsWith('.part'))
    .sort()
    .reverse();
  for (const stale of files.slice(1 + PREVIOUS_VERSIONS_KEPT)) {
    await rm(path.join(BULK_DIR, stale));
  }
}
