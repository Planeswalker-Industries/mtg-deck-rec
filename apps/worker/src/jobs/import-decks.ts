import { createHash } from 'node:crypto';
import { connect } from '../lib/db';
import { readJsonl, type JsonlStats } from '../lib/jsonl';
import type { SlimDeck } from '../sources/archidekt/deck';

/** The source every deck in a slim-deck file came from. */
const SOURCE = 'archidekt';
/** Rows per crawl_upsert_decks call, the same batch the crawl writes in: deck rows are wide. */
const UPSERT_BATCH = 100;
/** A slim deck keeps the commanders apart from the rest of the 100. */
const COMMANDER_DECK_SIZE = 100;

/** A type, not an interface, so it passes as JSON to postgres.js. */
type DeckRow = {
  source_deck_id: string;
  commanders: string[];
  cards: Record<string, number>;
  deck_size: number;
  content_hash: string;
  listed_updated_at: string;
  last_updated_at: string;
};

/**
 * The crawl's content hash (services/search-api/internal/crawl/run.go, contentHash): sorted commander oracle ids and
 * sorted `oracleId:copies` pairs. Matching it exactly is what lets the crawl recognise an imported deck as one it
 * already holds instead of rewriting it.
 */
export function contentHash(commanders: readonly string[], cards: Readonly<Record<string, number>>): string {
  const pairs = Object.keys(cards)
    .sort()
    .map((id) => `${id}:${cards[id]}`);
  return createHash('sha256')
    .update(`${[...commanders].sort().join('|')}\u0000${pairs.join('|')}`)
    .digest('hex');
}

/** A qualified slim deck as crawl_upsert_decks takes it. */
export function deckRow(deck: SlimDeck): DeckRow {
  const cards: Record<string, number> = {};
  for (const [oracleId, copies] of deck.cards) cards[oracleId] = (cards[oracleId] ?? 0) + copies;
  return {
    source_deck_id: String(deck.id),
    commanders: [...deck.commanders].sort(),
    cards,
    deck_size: COMMANDER_DECK_SIZE,
    content_hash: contentHash(deck.commanders, cards),
    listed_updated_at: deck.updatedAt,
    last_updated_at: deck.updatedAt,
  };
}

/**
 * Loads a file of slim Archidekt decks (one JSON object per line, the format the retired deck spike and deck lookups
 * wrote) into corpus.decks, through the same crawl_upsert_decks the crawl writes with: card ids resolved on write,
 * decks naming a card the catalog lacks left out, unchanged decks not rewritten. A one-time move of a deck file into the
 * database; re-running it changes nothing.
 */
export async function importDecks({ file }: { file: string }): Promise<void> {
  const sql = connect();
  const stats: JsonlStats = { lines: 0, parseErrors: 0 };
  let written = 0;
  let unresolved = 0;
  let batch: DeckRow[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const [result] = await sql<{ result: { written: number; unresolved: unknown[] } }[]>`
      select public.crawl_upsert_decks(${SOURCE}, ${sql.json(batch)}) as result
    `;
    written += result?.result.written ?? 0;
    unresolved += result?.result.unresolved.length ?? 0;
    batch = [];
  };

  try {
    for await (const deck of readJsonl<SlimDeck>(file, stats)) {
      batch.push(deckRow(deck));
      if (batch.length >= UPSERT_BATCH) await flush();
    }
    await flush();
    console.log(
      `import:decks: ${stats.lines} decks read, ${written} written to corpus.decks, ${unresolved} not stored (a card the ` +
        `catalog lacks), ${stats.parseErrors} unreadable lines. Run aggregate:corpus next.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
