import type {
  CardId,
  CollectionResolveVia,
  CollectionRowInput,
  Finish,
  PrintingId,
  ResolveCollectionResult,
  ResolvedCollectionRow,
  UnresolvedCollectionRow,
} from "@mtg/core/contract";
import { normalizeName } from "@mtg/core/parse";
import type { PublicClient } from "./supabase";

interface MatchRow {
  row_no: number;
  card_id: number;
  printing_id: string | null;
  lang: string | null;
  finishes: string[] | null;
  via: string;
}

const VIAS: ReadonlySet<string> = new Set<CollectionResolveVia>(["scryfall_id", "tcgplayer_id", "set_cn_lang", "set_cn", "name_only"]);

/**
 * How many rows go into one `resolve_collection_rows` call.
 *
 * PostgREST caps every response at `[api] max_rows` in `supabase/config.toml` (1000, the hosted default),
 * and a set-returning function is no exception: the overflow is dropped silently, so rows past the cap look
 * like they did not match. Each input row yields at most one match, so chunking the input to the cap keeps
 * every response under it. The caller may still send up to `MAX_COLLECTION_ROWS_PER_CALL` in one action.
 */
const MATCH_ROWS_PER_CALL = 1_000;

const FINISHES: ReadonlySet<string> = new Set<Finish>(["nonfoil", "foil", "etched"]);

const hasIdentifier = (row: CollectionRowInput) =>
  Boolean(row.scryfallId || row.tcgplayerId || (row.setCode && row.collectorNumber) || row.name?.trim());

/** The finish the row asked for, or the printing's usual one: nonfoil when it exists, otherwise its only finish. */
function finishFor(row: CollectionRowInput, printingFinishes: readonly string[] | null): Finish {
  if (row.finish) return row.finish;
  const known = (printingFinishes ?? []).filter((f): f is Finish => FINISHES.has(f));
  return known.includes("nonfoil") || known.length === 0 ? "nonfoil" : (known[0] ?? "nonfoil");
}

/**
 * Matches exported collection rows to printings and cards (up to 2,000 per call), most specific identifier first. Rows
 * with nothing to match on are INVALID; rows no identifier matched are NOT_FOUND.
 */
export async function resolveCollectionRows(db: PublicClient, rows: readonly CollectionRowInput[]): Promise<ResolveCollectionResult> {
  const epochResult = await db.rpc("catalog_epoch");
  if (epochResult.error) throw new Error(`Loading the catalog version failed: ${epochResult.error.message}`);

  const matches = new Map<number, MatchRow>();
  for (let start = 0; start < rows.length; start += MATCH_ROWS_PER_CALL) {
    const payload = rows.slice(start, start + MATCH_ROWS_PER_CALL).map((row) => ({
      rowNo: row.rowNo,
      scryfallId: row.scryfallId,
      tcgplayerId: row.tcgplayerId,
      setCode: row.setCode,
      collectorNumber: row.collectorNumber,
      lang: row.lang,
      nameNormalized: row.name ? normalizeName(row.name) : undefined,
    }));
    const { data, error } = await db.rpc("resolve_collection_rows", { p_rows: payload });
    if (error) throw new Error(`Matching collection rows failed: ${error.message}`);
    for (const match of (data ?? []) as MatchRow[]) matches.set(match.row_no, match);
  }
  const resolved: ResolvedCollectionRow[] = [];
  const unresolved: UnresolvedCollectionRow[] = [];

  for (const row of rows) {
    const match = matches.get(row.rowNo);
    if (!match || !VIAS.has(match.via)) {
      unresolved.push({ rowNo: row.rowNo, input: row, reason: hasIdentifier(row) ? "NOT_FOUND" : "INVALID" });
      continue;
    }
    resolved.push({
      rowNo: row.rowNo,
      printingId: match.printing_id as PrintingId | null,
      cardId: match.card_id as CardId,
      finish: finishFor(row, match.finishes),
      condition: row.condition?.trim() || "NM",
      lang: match.lang ?? row.lang?.toLowerCase() ?? "en",
      quantity: row.quantity,
      via: match.via as CollectionResolveVia,
    });
  }

  return { catalogEpoch: String(epochResult.data ?? "0"), resolved, unresolved };
}
