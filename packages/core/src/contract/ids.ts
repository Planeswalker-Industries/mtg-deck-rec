export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Internal surrogate key, 1:1 with a Scryfall oracle_id. Never reissued. */
export type CardId = Brand<number, 'CardId'>;
export type OracleId = Brand<string, 'OracleId'>;
/** Scryfall card (printing) id. */
export type PrintingId = Brand<string, 'PrintingId'>;
/** Tagger tag UUID. Slugs and labels are display-only and not stable. */
export type TagId = Brand<string, 'TagId'>;
/** A single commander or a partner pair. */
export type CommanderKeyId = Brand<number, 'CommanderKeyId'>;
/** Postgres bigint serialized as a string. */
export type DeckId = Brand<string, 'DeckId'>;

export type IsoDateTime = string;
/** Subset of 'WUBRG' in that order; '' means colorless. */
export type ColorIdentity = string;
export type Bracket = 1 | 2 | 3 | 4 | 5;
export type Finish = 'nonfoil' | 'foil' | 'etched';
