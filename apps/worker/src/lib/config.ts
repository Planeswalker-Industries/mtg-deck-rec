import os from 'node:os';
import path from 'node:path';

/** Sent on every outbound request. Identifies the app honestly; never rotated or spoofed. */
export const USER_AGENT = 'MTGDeckRec/0.1 (+https://github.com/Planeswalker-Industries/mtg-deck-rec)';

/**
 * Scratch space for downloads and reports: Scryfall's bulk files (re-downloaded when Scryfall publishes new ones) and
 * the measurement jobs' reports. Nothing here is kept; the data lives in Supabase. Override with MTG_DATA_DIR.
 */
export const DATA_DIR = process.env.MTG_DATA_DIR ?? path.join(os.tmpdir(), 'mtg-deck-rec');
export const BULK_DIR = path.join(DATA_DIR, 'bulk');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');
