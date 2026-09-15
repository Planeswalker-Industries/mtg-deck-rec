import { deckIdentityMask, estimateBracket, maskToIdentity, validateCommanderDeck } from "@mtg/core/commander";
import type {
  CardId,
  CommanderKeyId,
  DeckAnalysis,
  DeckCardEntry,
  DeckInput,
  ParseDeckResult,
  ResolvedLine,
  ResolveVia,
} from "@mtg/core/contract";
import { normalizeName, parseDecklist } from "@mtg/core/parse";
import { fetchCardsById, toCardSummary, toCommanderFacts, type CardRow } from "./cards";
import { commanderKeyCounts, loadCommanderCorpus, type CommanderCorpus } from "./corpus";
import type { PublicClient } from "./supabase";

/** Typo matches at or above this trigram similarity are accepted and flagged; below it the line stays unresolved. */
const FUZZY_ACCEPT_SCORE = 0.75;

/** At this trigram score the "typo" is only punctuation or spacing; treat it as an exact match. */
const FUZZY_EXACT_SCORE = 0.99;

const VIA_BY_ALIAS_KIND: Record<string, ResolveVia> = {
  full: "exact",
  loose: "exact",
  face: "front_face",
  flavor: "flavor_name",
  printed: "flavor_name",
  alchemy: "alchemy_mapped",
  fuzzy: "fuzzy",
};

interface NameMatch {
  input: string;
  card_id: number;
  via: string;
  score: number;
  rank: number;
}

export function deckFromLines(lines: readonly ResolvedLine[]): DeckInput {
  const commanders: CardId[] = [];
  const cards: DeckCardEntry[] = [];
  for (const { line, resolution } of lines) {
    if (resolution.status !== "resolved") continue;
    if (line.section === "commander") commanders.push(resolution.card.id);
    else cards.push({ cardId: resolution.card.id, quantity: line.quantity, section: line.section });
  }
  return { commanders, cards };
}

/** Parses pasted text and resolves every line against the card catalog. Analysis runs only when every line matched. */
export async function resolveDecklist(db: PublicClient, text: string): Promise<ParseDeckResult> {
  const { lines } = parseDecklist(text);
  const inputs = [...new Set(lines.map((l) => normalizeName(l.name)))];
  if (inputs.length === 0) return { lines: [], analysis: null };

  const { data, error } = await db.rpc("resolve_card_names", { p_names: inputs });
  if (error) throw new Error(`Resolving card names failed: ${error.message}`);
  const matches = (data ?? []) as NameMatch[];

  const byInput = new Map<string, NameMatch[]>();
  for (const m of matches) byInput.set(m.input, [...(byInput.get(m.input) ?? []), m]);
  const cards = await fetchCardsById(
    db,
    matches.map((m) => m.card_id),
  );
  const today = new Date().toISOString().slice(0, 10);

  const resolved: ResolvedLine[] = lines.map((line) => {
    const candidates = (byInput.get(normalizeName(line.name)) ?? [])
      .filter((m) => cards.has(m.card_id))
      .sort((a, b) => a.rank - b.rank);
    const summaries = candidates.flatMap((m) => {
      const row = cards.get(m.card_id);
      return row ? [toCardSummary(row, today)] : [];
    });
    const best = candidates[0];
    const bestCard = summaries[0];

    if (best && bestCard && (best.via !== "fuzzy" || best.score >= FUZZY_EXACT_SCORE)) {
      const via = line.flags.includes("alchemy_mapped") ? "alchemy_mapped" : (VIA_BY_ALIAS_KIND[best.via] ?? "exact");
      return { line, resolution: { status: "resolved", card: bestCard, via } };
    }
    if (best && bestCard && best.score >= FUZZY_ACCEPT_SCORE) {
      return { line: { ...line, flags: [...line.flags, "fuzzy"] }, resolution: { status: "resolved", card: bestCard, via: "fuzzy" } };
    }
    return { line: { ...line, flags: [...line.flags, "unresolved"] }, resolution: { status: "unresolved", suggestions: summaries } };
  });

  if (!resolved.every((l) => l.resolution.status === "resolved")) return { lines: resolved, analysis: null };
  const deck = deckFromLines(resolved);
  const corpus = await loadCommanderCorpus(db, deck.commanders);
  return { lines: resolved, analysis: analyzeDeck(deck, cards, today, corpus) };
}

/** Commander analysis for a resolved deck. Without corpus data, the commander key reports no decks. */
export function analyzeDeck(
  deck: DeckInput,
  cards: ReadonlyMap<number, CardRow>,
  today = new Date().toISOString().slice(0, 10),
  corpus: CommanderCorpus | null = null,
): DeckAnalysis {
  const row = (id: number) => {
    const found = cards.get(id);
    if (!found) throw new Error(`Card ${id} is not in the catalog.`);
    return found;
  };

  const commanderRows = deck.commanders.map(row);
  const commanders = commanderRows.map(toCommanderFacts);
  const entries = deck.cards.map((e) => ({ card: toCommanderFacts(row(e.cardId)), quantity: e.quantity, section: e.section }));
  const deckCardIds = [...new Set([...deck.commanders, ...deck.cards.filter((c) => c.section === "main").map((c) => c.cardId)])];
  const gameChangerIds = deckCardIds.filter((id) => row(id).game_changer);
  const estimatedBracket = estimateBracket({ gameChangerCount: gameChangerIds.length });

  const analysis: DeckAnalysis = {
    deck,
    colorIdentity: maskToIdentity(deckIdentityMask(commanders)),
    commanderKey: {
      id: (corpus?.keyId ?? null) as CommanderKeyId | null,
      slug: corpus?.slug ?? null,
      commanders: commanderRows.map((r) => toCardSummary(r, today)),
      ...commanderKeyCounts(corpus),
    },
    estimatedBracket,
    gameChangerIds,
    issues: validateCommanderDeck(commanders, entries, estimatedBracket),
  };
  if (commanders.length === 0) {
    analysis.commanderCandidates = deck.cards
      .map((e) => row(e.cardId))
      .filter((r) => r.can_be_commander)
      .map((r) => toCardSummary(r, today));
  }
  return analysis;
}

/** Loads the cards for a deck the client already resolved, then analyzes it. */
export async function analyzeDeckById(db: PublicClient, deck: DeckInput): Promise<DeckAnalysis> {
  const [cards, corpus] = await Promise.all([
    fetchCardsById(db, [...deck.commanders, ...deck.cards.map((c) => c.cardId)]),
    loadCommanderCorpus(db, deck.commanders),
  ]);
  return analyzeDeck(deck, cards, undefined, corpus);
}
