import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JsonRootStream, type JsonRootEvent } from './json-root-stream';

const encoder = new TextEncoder();

/** Feeds `text` to a fresh stream in chunks of the given sizes (the rest as one chunk) and collects every event. */
function read(text: string, arrayKeys: string[], chunkSizes: number[] = []): JsonRootEvent[] {
  const bytes = encoder.encode(text);
  const stream = new JsonRootStream(arrayKeys);
  const events: JsonRootEvent[] = [];
  let offset = 0;
  for (const size of chunkSizes) {
    events.push(...stream.push(bytes.subarray(offset, offset + size)));
    offset += size;
  }
  events.push(...stream.push(bytes.subarray(offset)));
  stream.end();
  return events;
}

const sample = JSON.stringify({
  timestamp: '2026-10-04T19:11:23+00:00',
  version: '7.1.4',
  variants: [
    { id: '1-2', uses: [{ card: { name: 'Thassa’s Oracle', text: 'a "quoted" ] }, \\ , value' } }], n: [1, [2, 3]] },
    { id: '3', uses: [], name: 'Jötun Grunt — 火' },
    7,
    'a, string]',
    null,
  ],
  aliases: [{ id: 'old', variant: null }],
  empty: [],
});

describe('JsonRootStream', () => {
  it('returns root members whole and splits the named arrays into elements', () => {
    expect(read(sample, ['variants'])).toEqual([
      { kind: 'member', key: 'timestamp', value: '2026-10-04T19:11:23+00:00' },
      { kind: 'member', key: 'version', value: '7.1.4' },
      { kind: 'element', key: 'variants', value: JSON.parse(sample).variants[0] },
      { kind: 'element', key: 'variants', value: { id: '3', uses: [], name: 'Jötun Grunt — 火' } },
      { kind: 'element', key: 'variants', value: 7 },
      { kind: 'element', key: 'variants', value: 'a, string]' },
      { kind: 'element', key: 'variants', value: null },
      { kind: 'member', key: 'aliases', value: [{ id: 'old', variant: null }] },
      { kind: 'member', key: 'empty', value: [] },
    ]);
  });

  it('gives the same events however the bytes are chunked, mid-character included', () => {
    const whole = read(sample, ['variants', 'empty']);
    const length = encoder.encode(sample).length;
    for (let cut = 1; cut < length; cut++) expect(read(sample, ['variants', 'empty'], [cut])).toEqual(whole);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { maxLength: 60 }), (sizes) => {
        expect(read(sample, ['variants', 'empty'], sizes)).toEqual(whole);
      }),
    );
  });

  it('accepts whitespace between tokens, as pretty-printed JSON has', () => {
    const pretty = JSON.stringify(JSON.parse(sample), null, 2);
    expect(read(pretty, ['variants'])).toEqual(read(sample, ['variants']));
  });

  it('round-trips arbitrary JSON values as elements and members', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue()), fc.jsonValue(), (items, other) => {
        const text = JSON.stringify({ items, other });
        const events = read(text, ['items']);
        // JSON.stringify writes -0 as 0, so compare against what the text actually says.
        const expected = JSON.parse(text) as { items: unknown[]; other: unknown };
        expect(events).toEqual([
          ...expected.items.map((value) => ({ kind: 'element', key: 'items', value })),
          { kind: 'member', key: 'other', value: expected.other },
        ]);
      }),
    );
  });

  it('reads an empty root object', () => {
    expect(read(' {} ', ['variants'])).toEqual([]);
  });

  it('refuses a document that is not one root object', () => {
    expect(() => read('[1, 2]', ['variants'])).toThrow(/Unexpected/);
    expect(() => read('{"a": 1} {"b": 2}', ['variants'])).toThrow(/Unexpected/);
    expect(() => read('{"a" 1}', ['variants'])).toThrow(/Unexpected/);
  });

  it('refuses a document that stops part-way', () => {
    expect(() => read('{"variants": [{"id": 1}', ['variants'])).toThrow(/ended before/);
    expect(() => read('', ['variants'])).toThrow(/ended before/);
  });

  it('lets JSON.parse reject a malformed element', () => {
    expect(() => read('{"variants": [{"id": }]}', ['variants'])).toThrow(SyntaxError);
  });
});
