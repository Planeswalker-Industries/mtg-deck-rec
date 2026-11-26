import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchClient, SearchError } from './client';

const client = () => new SearchClient({ url: 'https://search.test', token: 't', timeoutMs: 1_000 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearchClient.cardsByID', () => {
  it('names the fields it reads, and sends none when asked for whole documents', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ cards: [{ card_id: 1 }] }));
      }),
    );
    await client().cardsByID([1, 2], ['card_id', 'tag_ids']);
    await client().cardsByID([1, 2]);
    expect(bodies).toEqual([{ ids: [1, 2], fields: ['card_id', 'tag_ids'] }, { ids: [1, 2] }]);
  });
});

describe('SearchClient failures', () => {
  it('reports a download that fails after the headers as a SearchError with its timing', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'server-timing': 'typesense;dur=12.0' } })),
    );

    const failure = await client()
      .cardsByID([1])
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(SearchError);
    expect((failure as SearchError).timing).toMatchObject({ phase: 'body', serverTiming: 'typesense;dur=12.0' });
  });

  it('reports a request with no answer as the response phase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }),
    );
    const failure = await client()
      .cardsByID([1])
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(SearchError);
    expect((failure as SearchError).timing?.phase).toBe('response');
  });
});
