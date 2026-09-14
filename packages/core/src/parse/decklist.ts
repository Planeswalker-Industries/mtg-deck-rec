import type { DeckSection, Finish, LineFlag, ParsedLine } from '../contract';

const SECTION_ALIASES: Record<string, DeckSection> = {
  commander: 'commander',
  commanders: 'commander',
  'command zone': 'commander',
  deck: 'main',
  main: 'main',
  'main deck': 'main',
  mainboard: 'main',
  library: 'main',
  sideboard: 'sideboard',
  side: 'sideboard',
  maybeboard: 'maybeboard',
  maybe: 'maybeboard',
  considering: 'maybeboard',
  companion: 'companion',
  companions: 'companion',
};

/** "// Commander", "Commander:", "Deck (99)", "# Sideboard" */
const HEADER = /^(?:\/\/|#)?\s*([a-z][a-z ]*?)\s*(?:\(\d+\))?\s*:?\s*$/i;

/** "1x Sol Ring (C21) 263 *F*" — quantity, name, optional set + collector number, optional finish. */
const CARD_LINE =
  /^(?:(\d+)\s*[xX]?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†-]+))?)?(?:\s+\*([FE])\*)?$/;

/** Export decorations that aren't part of the card: Archidekt [Category] / ^Label^, Moxfield #!tag / #tag. */
const DECORATIONS = /\s+(?:\[[^\]]*\]|\^[^^]*\^|#!?\S+)/g;

export interface ParseDecklistResult {
  lines: ParsedLine[];
  /** True when the text used section headers; false for plain lists. */
  usedHeaders: boolean;
}

/**
 * Parses pasted decklist text from Arena, MTGO, Moxfield, Archidekt and hand-written lists into lines.
 * Name resolution happens later, against the card catalog.
 */
export function parseDecklist(text: string): ParseDecklistResult {
  const rawLines = text.replace(/^﻿/, '').split(/\r?\n/);
  const lines: ParsedLine[] = [];
  let section: DeckSection = 'main';
  let usedHeaders = false;
  // Blank-line-separated groups, used for the MTGO convention of a trailing commander block.
  const blocks: ParsedLine[][] = [[]];

  rawLines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if ((blocks.at(-1) ?? []).length > 0) {
        blocks.push([]);
        // "// Commander" exports (Moxfield) end the commander block with a blank line, not a "Deck" header.
        if (section === 'commander' || section === 'companion') section = 'main';
      }
      return;
    }

    const header = HEADER.exec(trimmed);
    const headerSection = header?.[1] ? SECTION_ALIASES[header[1].toLowerCase()] : undefined;
    if (headerSection) {
      section = headerSection;
      usedHeaders = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) return;

    let body = trimmed;
    let lineSection = section;
    const sideboardPrefix = /^SB:\s*/i.exec(body);
    if (sideboardPrefix) {
      body = body.slice(sideboardPrefix[0].length);
      lineSection = 'sideboard';
    }
    body = body.replace(DECORATIONS, '').trim();

    const match = CARD_LINE.exec(body);
    const rawName = match?.[2]?.replace(/\s+/g, ' ').trim();
    if (!match || !rawName) return;

    const quantity = match[1] === undefined ? 1 : Number(match[1]);
    if (quantity <= 0) return;

    const flags: LineFlag[] = [];
    let name = rawName;
    if (/^A-\S/.test(name)) {
      name = name.slice(2);
      flags.push('alchemy_mapped');
    }

    const line: ParsedLine = { lineNo: index + 1, raw, quantity, name, section: lineSection, flags };
    if (match[3]) line.setCode = match[3].toUpperCase();
    if (match[4]) line.collectorNumber = match[4];
    if (match[5]) line.finish = (match[5] === 'F' ? 'foil' : 'etched') satisfies Finish;

    lines.push(line);
    blocks.at(-1)?.push(line);
  });

  // MTGO/plain exports without headers put the commander(s) in a short final block after a blank line.
  const filledBlocks = blocks.filter((b) => b.length > 0);
  const last = filledBlocks.at(-1);
  if (!usedHeaders && filledBlocks.length >= 2 && last && last.length <= 2 && last.every((l) => l.quantity === 1)) {
    for (const line of last) line.section = 'commander';
  }

  return { lines, usedHeaders };
}
