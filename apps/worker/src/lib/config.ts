import path from 'node:path';

/** Sent on every outbound request. Identifies the app honestly; never rotated or spoofed. */
export const USER_AGENT = 'MTGDeckRec/0.1 (+https://github.com/Planeswalker-Industries/mtg-deck-rec)';

/** Large local data lives off the C: drive. Override with MTG_DATA_DIR. */
export const DATA_DIR = process.env.MTG_DATA_DIR ?? 'X:/mtg_proj';
export const BULK_DIR = path.join(DATA_DIR, 'bulk');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');
