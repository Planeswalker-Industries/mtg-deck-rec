import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

export interface JsonlStats {
  lines: number;
  parseErrors: number;
}

async function isGzip(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

/**
 * Streams a JSONL file (gzipped or not, detected from the file's magic bytes) one parsed object at a time.
 * Never loads the whole file; malformed lines are counted in `stats`, not thrown.
 */
export async function* readJsonl<T = unknown>(
  filePath: string,
  stats: JsonlStats = { lines: 0, parseErrors: 0 },
): AsyncGenerator<T> {
  let input: Readable = createReadStream(filePath);
  if (await isGzip(filePath)) input = input.pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.trim()) continue;
    stats.lines++;
    let value: T;
    try {
      value = JSON.parse(line) as T;
    } catch {
      stats.parseErrors++;
      continue;
    }
    yield value;
  }
}
