/** The sites whose collection share links the import box recognises. */
export type CollectionLinkSource = 'archidekt' | 'manabox' | 'moxfield' | 'tcgplayer';

/**
 * A pasted collection link. Only Archidekt links can be imported directly: Archidekt serves a public collection's
 * export to anyone. The others are recognised so the import can say how to export from that app instead of calling
 * the link unreadable — Moxfield's API needs authentication, and ManaBox and TCGplayer publish no share-link format
 * to build against.
 */
export type CollectionLink = { source: 'archidekt'; collectionId: number } | { source: Exclude<CollectionLinkSource, 'archidekt'> };

/** archidekt.com/collection/v2/642535, with or without the v2 segment, a trailing slash or query parameters. */
const ARCHIDEKT_COLLECTION = /^https?:\/\/(?:www\.)?archidekt\.com\/collection\/(?:v2\/)?(\d+)\/?(?:[?#].*)?$/i;

const OTHER_HOSTS: readonly [RegExp, Exclude<CollectionLinkSource, 'archidekt'>][] = [
  [/^https?:\/\/(?:[a-z0-9-]+\.)*manabox\.app(?:[/?#]|$)/i, 'manabox'],
  [/^https?:\/\/(?:[a-z0-9-]+\.)*moxfield\.com(?:[/?#]|$)/i, 'moxfield'],
  [/^https?:\/\/(?:[a-z0-9-]+\.)*tcgplayer\.com(?:[/?#]|$)/i, 'tcgplayer'],
];

/**
 * The collection link the import box holds, when all it holds is one link. A link inside an export (a CSV column of
 * product URLs, say) is not a request to fetch anything, so anything more than a single URL is left to the parser.
 */
export function collectionLink(text: string): CollectionLink | null {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  const archidekt = ARCHIDEKT_COLLECTION.exec(trimmed);
  if (archidekt?.[1]) return { source: 'archidekt', collectionId: Number(archidekt[1]) };
  for (const [host, source] of OTHER_HOSTS) if (host.test(trimmed)) return { source };
  return null;
}

/**
 * Rows per Archidekt export page. The same size Archidekt's own export button asks for, so a request here is never
 * larger than one the site already serves.
 */
export const ARCHIDEKT_EXPORT_PAGE_SIZE = 2500;

/**
 * The columns asked of Archidekt's export, in order. Each header it writes for them ("Edition Code", "Scryfall ID")
 * is one `parseCollectionCsv` already reads, so an export goes through the same parser as an uploaded CSV. The
 * Scryfall id is the point: it names the exact printing.
 */
export const ARCHIDEKT_EXPORT_FIELDS: readonly string[] = [
  'quantity',
  'card__oracleCard__name',
  'modifier',
  'condition',
  'language',
  'card__edition__editioncode',
  'card__uid',
  'card__collectorNumber',
];

export interface ArchidektExportPage {
  /** CSV with its header row. */
  csv: string;
  /** Rows in the whole collection, when Archidekt says. */
  totalRows: number | null;
  /** Whether another page follows this one. */
  more: boolean;
}

/** One page of an Archidekt collection export, or null when the response isn't one. */
export function archidektExportPage(body: unknown): ArchidektExportPage | null {
  if (typeof body !== 'object' || body === null) return null;
  const { content, totalRows, moreContent } = body as Record<string, unknown>;
  if (typeof content !== 'string') return null;
  return {
    csv: content,
    totalRows: typeof totalRows === 'number' && Number.isFinite(totalRows) ? totalRows : null,
    more: moreContent === true,
  };
}

/**
 * Joins export pages into one CSV. Every page repeats the header row; only the first keeps it, so the result reads
 * as one file. A later page whose first line is *not* that header is kept whole rather than losing a card.
 */
export function appendCsvPage(csv: string, page: string): string {
  if (csv === '') return page;
  const [pageHeader, pageBody] = splitFirstLine(page);
  const body = pageHeader === splitFirstLine(csv)[0] ? pageBody : page;
  if (body === '') return csv;
  return /\r?\n$/.test(csv) ? csv + body : `${csv}\r\n${body}`;
}

/** A text's first line and everything after its line break. */
function splitFirstLine(text: string): [string, string] {
  const match = /\r?\n/.exec(text);
  return match ? [text.slice(0, match.index), text.slice(match.index + match[0].length)] : [text, ''];
}
