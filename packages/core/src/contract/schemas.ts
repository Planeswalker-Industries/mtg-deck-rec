import { z } from 'zod';
import type { DeckInput } from './decks';
import type { ApiError, Result } from './errors';
import type { CardId, PrintingId } from './ids';
import type { RecContext } from './recs';

/**
 * Runtime validation for contract inputs that arrive over the network (Route Handler bodies, Server Action arguments).
 * Schemas whose output is typed as a contract type fail typecheck when the contract drifts.
 */
export type InputSchema<T> = z.ZodType<T>;

export const MAX_DECKLIST_CHARS = 20_000;
export const MAX_DECK_ENTRIES = 400;
export const MAX_OWNED_CARDS = 60_000;
const MAX_URL_CHARS = 2_000;
const MAX_COPIES = 250;

const cardId = (message: string) =>
  z
    .int({ error: message })
    .min(1, message)
    .transform((id) => id as CardId);

export const deckInputSchema: InputSchema<DeckInput> = z.object(
  {
    commanders: z.array(cardId("Invalid commander.")).max(2, 'A deck has at most two commanders.'),
    cards: z
      .array(
        z.object({
          cardId: cardId('Invalid card in the deck.'),
          quantity: z.int().min(1).max(MAX_COPIES),
          section: z.enum(['commander', 'main', 'sideboard', 'maybeboard', 'companion']),
        }),
      )
      .max(MAX_DECK_ENTRIES, `A deck can list at most ${MAX_DECK_ENTRIES} cards.`),
  },
  { error: "That deck isn't valid." },
);

const ownershipSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('session'),
      catalogEpoch: z.string().max(100),
      ownedCardIds: z.array(cardId('Invalid card in the collection.')).max(MAX_OWNED_CARDS, 'That collection is too large.'),
    }),
    z.object({ kind: z.literal('account') }),
  ],
  { error: 'Invalid collection.' },
);

export const recContextSchema: InputSchema<RecContext> = z.object(
  {
    deck: deckInputSchema,
    bracket: z.literal([1, 2, 3, 4, 5], { error: 'Pick a bracket from 1 to 5.' }),
    bracketSource: z.enum(['inferred', 'user'], { error: 'Invalid bracket source.' }),
    includeGameChangers: z.boolean({ error: 'Invalid Game Changer setting.' }),
    /** Omitted means collection-less. */
    ownership: ownershipSchema.nullable().default(null),
  },
  { error: 'Missing deck.' },
);

const limit = z.int().min(1).optional();
const request = { error: 'Invalid request.' };

export const swapInputSchema = z.object(
  { context: recContextSchema, targetCardId: cardId('Pick a card to replace.'), limit },
  request,
);
export const addInputSchema = z.object({ context: recContextSchema, limitPerCategory: limit }, request);
export const cutInputSchema = z.object({ context: recContextSchema, limit }, request);

export const parseDeckInputSchema = z.object(
  {
    text: z
      .string({ error: 'Send the decklist as text.' })
      .max(MAX_DECKLIST_CHARS, `Decklists can be at most ${MAX_DECKLIST_CHARS.toLocaleString('en-US')} characters.`),
  },
  request,
);
export const importDeckInputSchema = z.object(
  { url: z.string({ error: 'Paste a link to a deck.' }).trim().max(MAX_URL_CHARS, 'That link is too long.') },
  request,
);
export const analyzeDeckInputSchema = z.object({ deck: deckInputSchema }, request);
export const commanderInputSchema = z.object({ commanderId: cardId("That commander isn't valid.") }, request);
export const commanderRequestInputSchema = z.object(
  { requestId: z.string({ error: "That deck lookup isn't valid." }).regex(/^\d{1,15}$/, "That deck lookup isn't valid.") },
  request,
);

export const MAX_COLLECTION_ROWS_PER_CALL = 2_000;

const collectionRow = z.object({
  rowNo: z.int().min(0),
  name: z.string().max(200).optional(),
  scryfallId: z.string().max(64).optional(),
  tcgplayerId: z.int().min(1).optional(),
  setCode: z.string().max(10).optional(),
  collectorNumber: z.string().max(16).optional(),
  lang: z.string().max(8).optional(),
  finish: z.enum(['nonfoil', 'foil', 'etched']).optional(),
  condition: z.string().max(32).optional(),
  quantity: z.int().min(1, 'Quantities must be at least 1.').max(100_000),
});

const rowsPerCall = `Send at most ${MAX_COLLECTION_ROWS_PER_CALL.toLocaleString('en-US')} rows per call.`;

export const resolveCollectionRowsInputSchema = z.object(
  { rows: z.array(collectionRow).max(MAX_COLLECTION_ROWS_PER_CALL, rowsPerCall) },
  request,
);

const resolvedCollectionRow = z.object({
  rowNo: z.int().min(0),
  printingId: z
    .guid('Invalid printing in the collection.')
    .nullable()
    .transform((id) => id as PrintingId | null),
  cardId: cardId('Invalid card in the collection.'),
  finish: z.enum(['nonfoil', 'foil', 'etched']),
  condition: z.string().min(1).max(32),
  lang: z.string().min(1).max(8),
  quantity: z.int().min(1, 'Quantities must be at least 1.').max(100_000),
  via: z.enum(['scryfall_id', 'tcgplayer_id', 'set_cn_lang', 'set_cn', 'name_only']),
});

export const saveCollectionBatchInputSchema = z.object(
  {
    importId: z.string().regex(/^\d{1,15}$/, "That import isn't valid.").nullable(),
    sourceApp: z.enum(['manabox', 'moxfield', 'tcgplayer', 'generic_csv', 'generic_json', 'text']),
    mode: z.enum(['replace', 'merge']),
    rows: z.array(resolvedCollectionRow).max(MAX_COLLECTION_ROWS_PER_CALL, rowsPerCall),
    final: z.boolean(),
  },
  request,
);

/**
 * Validates untrusted input against a schema. Text or lists over their size limit are PAYLOAD_TOO_LARGE; anything else
 * invalid is VALIDATION. The first problem becomes the message, and every problem is listed by field.
 */
export function parseInput<T>(schema: InputSchema<T>, value: unknown): Result<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };

  const { issues } = parsed.error;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field = issue.path.map(String).join('.') || 'input';
    (fieldErrors[field] ??= []).push(issue.message);
  }
  const tooLarge = issues.some((i) => i.code === 'too_big' && (i.origin === 'string' || i.origin === 'array'));
  const error: ApiError = {
    code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION',
    message: issues[0]?.message ?? 'Invalid request.',
    fieldErrors,
  };
  return { ok: false, error };
}
