// Pure-logic smoke tests for src/lib/channels.ts — handle normalization, slugging, and the
// channels.md / state.md (de)serializers. No network, no filesystem: deterministic strings only.
// Runs under both `vitest run` (Node) and `bun test` (Bun) — globals only, no runner import.
import {
  normalizeHandle,
  slugify,
  serializeChannels,
  serializeState,
  baselineStateRow,
} from '../src/lib/channels.ts';
import { parseChannels, parseState } from '../src/lib/yt-lib.ts';
import type { StateRow } from '../src/lib/yt-lib.ts';

describe('normalizeHandle', () => {
  it('passes through an @handle', () => {
    expect(normalizeHandle('@betterstack')).toBe('@betterstack');
  });
  it('prepends @ to a bare handle', () => {
    expect(normalizeHandle('betterstack')).toBe('@betterstack');
  });
  it('pulls the @handle out of a channel URL', () => {
    expect(normalizeHandle('https://www.youtube.com/@betterstack')).toBe('@betterstack');
  });
  it('ignores a trailing /videos on the URL', () => {
    expect(normalizeHandle('https://www.youtube.com/@betterstack/videos')).toBe('@betterstack');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeHandle('  @foo  ')).toBe('@foo');
  });
  it('keeps a full non-ASCII handle (Unicode letters)', () => {
    expect(normalizeHandle('@DziałZagraniczny')).toBe('@DziałZagraniczny');
  });
  it('returns null for empty input', () => {
    expect(normalizeHandle('')).toBeNull();
  });
  it('returns null for a /channel/UC… URL with no @handle', () => {
    expect(normalizeHandle('https://www.youtube.com/channel/UC1234567890')).toBeNull();
  });
});

describe('slugify', () => {
  it('breaks CamelCase into kebab-case', () => {
    expect(slugify('BetterStack')).toBe('better-stack');
  });
  it('strips a leading @', () => {
    expect(slugify('@BetterStack')).toBe('better-stack');
  });
  it('folds Polish diacritics to ASCII (ł has no NFD form)', () => {
    expect(slugify('DziałZagraniczny')).toBe('dzial-zagraniczny');
  });
  it('folds combining diacritics and collapses spaces', () => {
    expect(slugify('Zażółć Gęślą')).toBe('zazolc-gesla');
  });
  it('collapses runs of separators', () => {
    expect(slugify('foo   bar')).toBe('foo-bar');
  });
});

describe('channels.md round-trip', () => {
  it('serialize → parse recovers the entries', () => {
    const entries = [
      { handle: '@Foo', slug: 'foo' },
      { handle: '@BetterStack', slug: 'better-stack' },
    ];
    expect(parseChannels(serializeChannels(entries, '2024-01-01'))).toEqual(entries);
  });
});

describe('state.md round-trip', () => {
  it('serialize → parse recovers a row, mapping —/values both ways', () => {
    const row: StateRow = {
      handle: '@Foo',
      last_longform_id: 'abc123',
      last_short_id: null,
      last_live_id: null,
      updated: '2024-01-01',
      session: 3,
    };
    expect(parseState(serializeState([row], '2024-01-01'))).toEqual([row]);
  });
});

describe('baselineStateRow', () => {
  it('echoes the handle, nulls every cursor, session 0, ISO date', () => {
    const r = baselineStateRow('@Foo');
    expect(r.handle).toBe('@Foo');
    expect(r.last_longform_id).toBeNull();
    expect(r.last_short_id).toBeNull();
    expect(r.last_live_id).toBeNull();
    expect(r.session).toBe(0);
    expect(r.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
