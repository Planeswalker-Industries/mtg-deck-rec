/** Taking a deck away as a text file, built in the browser: an unsaved deck has no export route to link to. */

/** A download's file name from the deck's commanders: letters, digits, spaces and dashes only. */
export function deckFileName(commanders: (string | undefined)[], extension = "txt"): string {
  const name = commanders.filter(Boolean).join(" and ").replace(/[^\p{L}\p{N} -]+/gu, "").replace(/\s+/g, " ").trim();
  return `${name || "decklist"}.${extension}`;
}

/** Saves text as a file, in the browser: an unsaved deck has no export route to link to. */
export function downloadText(text: string | null, fileName: string, type = "text/plain;charset=utf-8") {
  if (text === null) return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
