import os from 'node:os';
import path from 'node:path';

/** Sent on every outbound request. Identifies the app honestly; never rotated or spoofed. */
export const USER_AGENT = 'MTGDeckRec/0.1 (+https://github.com/Planeswalker-Industries/mtg-deck-rec)';

/**
 * Scratch space for Scryfall's bulk downloads, which are fetched again whenever Scryfall publishes new ones. Nothing
 * here is kept: the data lives in Postgres. Override with MTG_DATA_DIR (a machine with a small system drive points it
 * elsewhere).
 */
export const DATA_DIR = process.env.MTG_DATA_DIR ?? path.join(os.tmpdir(), 'mtg-deck-rec');
export const BULK_DIR = path.join(DATA_DIR, 'bulk');
