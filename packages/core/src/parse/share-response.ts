/**
 * Share-link imports fetch a deck or collection link a user pasted (Archidekt, ManaBox, Moxfield, TCGplayer, ...).
 * These helpers classify what came back, so a bot-protection block can switch that site's imports off instead of
 * being retried or worked around.
 */

export type ShareResponseKind = 'ok' | 'bot_blocked' | 'not_public' | 'not_found' | 'rate_limited' | 'unavailable';

export interface ShareResponseFacts {
  status: number;
  headers: { get(name: string): string | null };
  /** The start of the body is enough; challenge pages identify themselves early. */
  body: string;
  /** What the site normally answers this request with. */
  expects: 'json' | 'html' | 'text';
}

/** Text that only appears on bot-protection challenge or block pages. */
const CHALLENGE_MARKERS = [
  /\/cdn-cgi\/challenge-platform\//i,
  /\bcf[-_]chl[-_]/i,
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /<title>\s*attention required!\s*\|\s*cloudflare\s*<\/title>/i,
  /cf-browser-verification/i,
];

/** Statuses that count as a block when they don't come back in the site's usual format. */
const BLOCK_STATUSES = new Set([403, 409]);

function looksLikeChallenge({ headers, body }: ShareResponseFacts): boolean {
  if (/challenge/i.test(headers.get('cf-mitigated') ?? '')) return true;
  return CHALLENGE_MARKERS.some((marker) => marker.test(body));
}

/**
 * Sorts a share-link response. A Cloudflare challenge is a block at any status. A 403 or 409 is a block when the site
 * answered in a different format than usual (an HTML page where its API returns JSON); in the usual format it means the
 * list is private or unavailable to anyone, so it only affects that link.
 */
export function classifyShareResponse(facts: ShareResponseFacts): ShareResponseKind {
  if (looksLikeChallenge(facts)) return 'bot_blocked';

  const { status, headers, expects } = facts;
  const contentType = headers.get('content-type') ?? '';
  const unusualFormat = expects === 'json' ? !/json/i.test(contentType) : false;

  if (BLOCK_STATUSES.has(status)) return unusualFormat ? 'bot_blocked' : 'not_public';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 200 && status < 300) return 'ok';
  return 'unavailable';
}
