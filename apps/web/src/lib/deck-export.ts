/** The file formats a saved deck downloads as, shared by the export route and the buttons that link to it. */
export const DECK_EXPORT_FORMATS = ["txt", "csv"] as const;

export type DeckExportFormat = (typeof DECK_EXPORT_FORMATS)[number];

export const isDeckExportFormat = (value: string | null): value is DeckExportFormat =>
  (DECK_EXPORT_FORMATS as readonly string[]).includes(value ?? "");

/** Where a deck's download lives: beside its page, so the same visibility rules apply to both. */
export const deckExportHref = (commanderSlug: string, code: string, format: DeckExportFormat): string =>
  `/decks/${encodeURIComponent(commanderSlug)}/${encodeURIComponent(code)}/export?format=${format}`;
