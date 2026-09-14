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
  const payload = rows.map((row) => ({
    rowNo: row.rowNo,
    scryfallId: row.scryfallId,
    tcgplayerId: row.tcgplayerId,
    setCode: row.setCode,
    collectorNumber: row.collectorNumber,
    lang: row.lang,
    nameNormalized: row.name ? normalizeName(row.name) : undefined,
  }));

  const [matchResult, epochResult] = await Promise.all([
    rows.length > 0 ? db.rpc("resolve_collection_rows", { p_rows: payload }) : Promise.resolve({ data: [] as MatchRow[], error: null }),
    db.rpc("catalog_epoch"),
  ]);
  if (matchResult.error) throw new Error(`Matching collection rows failed: ${matchResult.error.message}`);
  if (epochResult.error) throw new Error(`Loading the catalog version failed: ${epochResult.error.message}`);

  const matches = new Map(((matchResult.data ?? []) as MatchRow[]).map((m) => [m.row_no, m]));
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
