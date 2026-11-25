import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_CONTEXT_KEYS,
  MAX_ERROR_DETAIL_BYTES,
  MAX_ERROR_MESSAGE_CHARS,
  boundContext,
  describeError,
  errorFingerprintSource,
  fitErrorDetail,
  normalizeErrorMessage,
  redactPersonalData,
  sitePath,
} from './index';

describe('normalizeErrorMessage', () => {
  it('makes repeats of one failure read the same', () => {
    expect(normalizeErrorMessage('Import 52 failed after 29,382 rows')).toBe(normalizeErrorMessage('Import 53 failed after 1,204 rows'));
    expect(normalizeErrorMessage('No deck 4f1c2a9e-1b2c-4d3e-8f90-0123456789ab')).toBe('no deck <id>');
    expect(normalizeErrorMessage('invalid input syntax for type uuid: "<user_id from step 1>"')).toBe(
      'invalid input syntax for type uuid: <value>',
    );
    expect(normalizeErrorMessage('GET /api/cards/search?q=sol failed')).toBe('get /api/cards/search?… failed');
  });

  it('keeps different failures apart', () => {
    expect(normalizeErrorMessage('canceling statement due to statement timeout')).not.toBe(
      normalizeErrorMessage('duplicate key value violates unique constraint'),
    );
  });
});

describe('errorFingerprintSource', () => {
  it('ignores what changes between occurrences but not where it happened', () => {
    const a = errorFingerprintSource({
      source: 'server',
      area: 'collection.saveBatch',
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'import 52',
    });
    const b = errorFingerprintSource({
      source: 'server',
      area: 'collection.saveBatch',
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'import 53',
    });
    const c = errorFingerprintSource({
      source: 'client',
      area: 'collection.saveBatch',
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'import 53',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('describeError', () => {
  it('keeps an error, its database fields and its causes', () => {
    const root = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014', hint: 'try less' });
    const err = new Error('Finishing the collection import failed', { cause: root });
    const described = describeError(err);
    expect(described.name).toBe('Error');
    expect(described.message).toBe('Finishing the collection import failed');
    expect(described.stack).toContain('Finishing the collection import failed');
    expect(described.causes?.[0]).toMatchObject({
      message: 'canceling statement due to statement timeout',
      code: '57014',
      hint: 'try less',
    });
  });

  it('reads a plain error object the way Supabase returns one', () => {
    expect(describeError({ message: 'permission denied', code: '42501', details: null })).toEqual({
      name: 'NonError',
      message: 'permission denied',
      code: '42501',
    });
  });

  it('copes with anything thrown', () => {
    expect(describeError('boom')).toEqual({ name: 'NonError', message: 'boom' });
    expect(describeError(undefined).message).toBe('undefined');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
    expect(describeError(new Error('x'.repeat(MAX_ERROR_MESSAGE_CHARS * 2))).message).toHaveLength(MAX_ERROR_MESSAGE_CHARS);
  });

  it('follows a cause chain only so far', () => {
    let err = new Error('0');
    for (let i = 1; i < 10; i += 1) err = new Error(String(i), { cause: err });
    expect(describeError(err).causes).toHaveLength(3);
  });
});

describe('boundContext', () => {
  it('keeps scalar facts only, and only so many', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_ERROR_CONTEXT_KEYS + 5 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(boundContext(many) ?? {})).toHaveLength(MAX_ERROR_CONTEXT_KEYS);
    expect(boundContext({ rows: 3, deck: { cards: ['Sol Ring'] }, list: [1], ok: true, none: null, bad: Number.NaN })).toEqual({
      rows: 3,
      ok: true,
      none: null,
      bad: 'NaN',
    });
    expect(boundContext({ deck: {} })).toBeUndefined();
  });
});

describe('sitePath', () => {
  it('keeps the path and drops the rest', () => {
    expect(sitePath('/deck?list=Sol+Ring#top')).toBe('/deck');
    expect(sitePath('https://www.spellchasm.com/collection?x=1')).toBe('/collection');
    expect(sitePath('//evil.test/x')).toBeUndefined();
    expect(sitePath('not a url')).toBeUndefined();
    expect(sitePath(null)).toBeUndefined();
  });
});

describe('fitErrorDetail', () => {
  it('leaves a small detail alone', () => {
    const detail = { error: { name: 'Error', message: 'x' } };
    expect(fitErrorDetail(detail)).toBe(detail);
  });

  it('drops the bulkiest parts until it fits', () => {
    const big = 'x'.repeat(MAX_ERROR_DETAIL_BYTES);
    const fitted = fitErrorDetail({ error: { name: 'Error', message: 'm', stack: big }, context: { a: 1 } });
    expect(fitted).toEqual({ error: { name: 'Error', message: 'm' }, context: { a: 1 }, truncated: true });
    expect(fitErrorDetail({ blob: big })).toEqual({ truncated: true });
  });
});

describe('redactPersonalData', () => {
  it('takes email addresses out', () => {
    expect(redactPersonalData('Email address "player.one+mtg@example.co.uk" is invalid')).toBe('Email address "<email>" is invalid');
    expect(redactPersonalData('no address here @ all')).toBe('no address here @ all');
  });
});
