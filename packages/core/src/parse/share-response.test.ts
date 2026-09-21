import { describe, expect, it } from 'vitest';
import { classifyShareResponse, type ShareResponseFacts } from './share-response';

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

const response = (overrides: Partial<ShareResponseFacts> & { headerValues?: Record<string, string> } = {}): ShareResponseFacts => {
  const { headerValues = { 'content-type': 'application/json' }, ...rest } = overrides;
  return { status: 200, headers: headers(headerValues), body: '{"cards":[]}', expects: 'json', ...rest };
};

const CHALLENGE_PAGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>';

describe('classifyShareResponse', () => {
  it('passes normal responses', () => {
    expect(classifyShareResponse(response())).toBe('ok');
  });

  it('treats a Cloudflare challenge as a block at any status', () => {
    expect(classifyShareResponse(response({ status: 403, headerValues: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }, body: '' }))).toBe('bot_blocked');
    expect(classifyShareResponse(response({ status: 503, headerValues: { 'content-type': 'text/html' }, body: CHALLENGE_PAGE }))).toBe('bot_blocked');
    expect(classifyShareResponse(response({ status: 200, headerValues: { 'content-type': 'text/html' }, body: CHALLENGE_PAGE }))).toBe('bot_blocked');
  });

  it('treats a 403 or 409 in an unexpected format as a block', () => {
    expect(classifyShareResponse(response({ status: 403, headerValues: { 'content-type': 'text/html' }, body: '<html>Forbidden</html>' }))).toBe('bot_blocked');
    expect(classifyShareResponse(response({ status: 409, headerValues: { 'content-type': 'text/plain' }, body: 'Conflict' }))).toBe('bot_blocked');
  });

  it('treats a 403 or 409 in the site usual format as a private or unavailable list', () => {
    expect(classifyShareResponse(response({ status: 403, body: '{"detail":"You do not have permission to perform this action."}' }))).toBe('not_public');
    expect(classifyShareResponse(response({ status: 409, body: '{"error":"conflict"}' }))).toBe('not_public');
    expect(classifyShareResponse(response({ status: 403, headerValues: { 'content-type': 'text/html' }, body: '<html>Private</html>', expects: 'html' }))).toBe('not_public');
  });

  it('does not count ordinary Cloudflare-served responses as blocks', () => {
    expect(classifyShareResponse(response({ headerValues: { 'content-type': 'application/json', server: 'cloudflare', 'cf-ray': 'abc' } }))).toBe('ok');
  });

  it('reports missing lists, rate limits and outages', () => {
    expect(classifyShareResponse(response({ status: 404 }))).toBe('not_found');
    expect(classifyShareResponse(response({ status: 400, body: '{"error":"No collection found."}' }))).toBe('not_found');
    expect(classifyShareResponse(response({ status: 400, headerValues: { 'content-type': 'text/html' }, body: '<html>Bad request</html>' }))).toBe('unavailable');
    expect(classifyShareResponse(response({ status: 429 }))).toBe('rate_limited');
    expect(classifyShareResponse(response({ status: 502, headerValues: { 'content-type': 'text/html' }, body: 'Bad gateway' }))).toBe('unavailable');
  });
});
