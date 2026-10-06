/**
 * Reads a JSON document shaped `{"key": value, "items": [ {...}, {...} ], ...}` a chunk at a time and hands back each
 * root member, with the arrays named in `arrayKeys` split into their elements. For documents too large to hold as one
 * string: Commander Spellbook's `variants.json` is about 680 MB, past V8's string limit, and has no line breaks, so it
 * can be neither `JSON.parse`d whole nor read as JSONL.
 *
 * It scans bytes rather than characters. Every byte that matters to JSON's structure is ASCII, and no byte of a
 * multi-byte UTF-8 character is, so a chunk may end anywhere, mid-character included. Each member or element is parsed
 * with `JSON.parse` once complete, so the scanner only has to find where values start and end; JSON.parse still
 * rejects anything malformed inside one.
 */

export type JsonRootEvent =
  /** A root member whose key is not in `arrayKeys`, parsed whole. */
  | { kind: 'member'; key: string; value: unknown }
  /** One element of a root array named in `arrayKeys`. */
  | { kind: 'element'; key: string; value: unknown };

const QUOTE = 0x22; // "
const BACKSLASH = 0x5c; // \
const COMMA = 0x2c; // ,
const COLON = 0x3a; // :
const OPEN_OBJECT = 0x7b; // {
const CLOSE_OBJECT = 0x7d; // }
const OPEN_ARRAY = 0x5b; // [
const CLOSE_ARRAY = 0x5d; // ]

/** Depth of the root object's members, and of the elements of a root array that is being split. */
const ROOT_DEPTH = 1;
const ELEMENT_DEPTH = 2;

const isWhitespace = (byte: number) => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;

type Expect = 'root' | 'key' | 'colon' | 'value' | 'separator' | 'done';

export class JsonRootStream {
  private readonly arrayKeys: ReadonlySet<string>;
  private readonly decoder = new TextDecoder();

  private depth = 0;
  private inString = false;
  private escaped = false;
  private expect: Expect = 'root';
  private key = '';
  /** Inside a root array named in arrayKeys, between its brackets. */
  private splitting = false;

  /** Bytes of the key, member or element being read, which can span chunks. */
  private capture: Uint8Array[] | null = null;
  private captureKind: 'key' | 'member' | 'element' | null = null;

  constructor(arrayKeys: Iterable<string>) {
    this.arrayKeys = new Set(arrayKeys);
  }

  /** Feeds the next chunk; returns the members and elements it completed, in document order. */
  push(chunk: Uint8Array): JsonRootEvent[] {
    const events: JsonRootEvent[] = [];
    let captureFrom = this.capture ? 0 : -1;

    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i] as number;

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (byte === BACKSLASH) this.escaped = true;
        else if (byte === QUOTE) {
          this.inString = false;
          if (this.captureKind === 'key') {
            this.key = this.finish(chunk, captureFrom, i + 1) as string;
            captureFrom = -1;
            this.expect = 'colon';
          }
        }
        continue;
      }

      // The end of a member or element: a separator or the closing bracket at the depth it started at.
      if (this.captureKind === 'member' && this.depth === ROOT_DEPTH && (byte === COMMA || byte === CLOSE_OBJECT)) {
        events.push({ kind: 'member', key: this.key, value: this.finish(chunk, captureFrom, i) });
        captureFrom = -1;
        this.expect = 'separator';
      } else if (this.captureKind === 'element' && this.depth === ELEMENT_DEPTH && (byte === COMMA || byte === CLOSE_ARRAY)) {
        events.push({ kind: 'element', key: this.key, value: this.finish(chunk, captureFrom, i) });
        captureFrom = -1;
      }

      if (isWhitespace(byte)) continue;

      if (this.splitting && this.depth === ELEMENT_DEPTH && this.captureKind === null) {
        if (byte === COMMA) continue;
        if (byte === CLOSE_ARRAY) {
          this.depth--;
          this.splitting = false;
          this.expect = 'separator';
          continue;
        }
        this.start('element');
        captureFrom = i;
      } else if (this.depth === ROOT_DEPTH && this.captureKind === null) {
        switch (this.expect) {
          case 'key':
            if (byte === CLOSE_OBJECT) break; // an empty root object
            if (byte !== QUOTE) throw this.unexpected(byte);
            this.start('key');
            captureFrom = i;
            break;
          case 'colon':
            if (byte !== COLON) throw this.unexpected(byte);
            this.expect = 'value';
            continue;
          case 'value':
            if (byte === OPEN_ARRAY && this.arrayKeys.has(this.key)) {
              this.depth++;
              this.splitting = true;
              continue;
            }
            this.start('member');
            captureFrom = i;
            break;
          case 'separator':
            if (byte === COMMA) {
              this.expect = 'key';
              continue;
            }
            if (byte !== CLOSE_OBJECT) throw this.unexpected(byte);
            break;
          default:
            throw this.unexpected(byte);
        }
      } else if (this.depth === 0) {
        if (this.expect !== 'root' || byte !== OPEN_OBJECT) throw this.unexpected(byte);
        this.depth = ROOT_DEPTH;
        this.expect = 'key';
        continue;
      }

      if (byte === QUOTE) this.inString = true;
      else if (byte === OPEN_OBJECT || byte === OPEN_ARRAY) this.depth++;
      else if (byte === CLOSE_OBJECT || byte === CLOSE_ARRAY) {
        this.depth--;
        if (this.depth === 0) this.expect = 'done';
      }
    }

    if (this.capture && captureFrom >= 0) this.capture.push(chunk.slice(captureFrom));
    return events;
  }

  /** Throws unless the document ended where a complete root object ends. */
  end(): void {
    if (this.expect !== 'done') throw new Error('JSON document ended before its root object closed');
  }

  private start(kind: 'key' | 'member' | 'element'): void {
    this.capture = [];
    this.captureKind = kind;
  }

  /** Completes the capture with `chunk[from, to)` (from is 0 when it began in an earlier chunk) and parses it. */
  private finish(chunk: Uint8Array, from: number, to: number): unknown {
    const parts = this.capture ?? [];
    parts.push(chunk.subarray(Math.max(from, 0), to));
    this.capture = null;
    this.captureKind = null;
    const bytes = parts.length === 1 ? (parts[0] as Uint8Array) : concat(parts);
    return JSON.parse(this.decoder.decode(bytes));
  }

  private unexpected(byte: number): Error {
    return new Error(`Unexpected ${JSON.stringify(String.fromCharCode(byte))} in the JSON document's root object`);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
