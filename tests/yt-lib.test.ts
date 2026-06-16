// Pure-logic smoke tests for src/lib/yt-lib.ts — channels.md / state.md parsing, the per-video
// cursor bump, and the channel-profile section writers. Deterministic strings only (dates passed
// in as arguments). Globals only — runs under vitest (Node) and bun test (Bun).
import {
  parseChannels,
  parseState,
  bumpStatePointer,
  isResolved,
  appendToSection,
  appendSkipTitle,
  appendNote,
  SKIP_TITLES_HEADING,
  NOTES_HEADING,
} from '../src/lib/yt-lib.ts';

describe('parseChannels', () => {
  it('reads entry lines and ignores noise', () => {
    const md = [
      '# Channels',
      '',
      '- [@Foo](https://www.youtube.com/@Foo) → [[channels/foo]]',
      'not an entry',
      '- [@BetterStack](https://www.youtube.com/@BetterStack) → [[channels/better-stack]]',
    ].join('\n');
    expect(parseChannels(md)).toEqual([
      { handle: '@Foo', slug: 'foo' },
      { handle: '@BetterStack', slug: 'better-stack' },
    ]);
  });
  it('returns [] for empty input', () => {
    expect(parseChannels('')).toEqual([]);
  });
});

describe('parseState', () => {
  it('parses a row and maps — to null', () => {
    const md = [
      '| Channel | last_longform_id | last_short_id | last_live_id | updated | session |',
      '|---|---|---|---|---|---|',
      '| @Foo | abc123 | — | — | 2024-01-01 | 2 |',
    ].join('\n');
    expect(parseState(md)).toEqual([
      {
        handle: '@Foo',
        last_longform_id: 'abc123',
        last_short_id: null,
        last_live_id: null,
        updated: '2024-01-01',
        session: 2,
      },
    ]);
  });
});

describe('bumpStatePointer', () => {
  const base = [
    '---',
    'updated: 2024-01-01',
    '---',
    '',
    '# State',
    '',
    '| Channel | last_longform_id | last_short_id | last_live_id | updated | session |',
    '|---|---|---|---|---|---|',
    '| @Foo | — | — | — | 2024-01-01 | 1 |',
  ].join('\n');

  it('sets the cursor, advances date, and increments session on a new day', () => {
    const out = bumpStatePointer(base, '@Foo', 'longform', 'vid123', '2024-01-02');
    const [row] = parseState(out);
    expect(row!.last_longform_id).toBe('vid123');
    expect(row!.updated).toBe('2024-01-02');
    expect(row!.session).toBe(2);
    expect(out).toContain('updated: 2024-01-02'); // frontmatter bumped too
  });

  it('does not re-increment session within the same day', () => {
    const once = bumpStatePointer(base, '@Foo', 'longform', 'vid123', '2024-01-02');
    const twice = bumpStatePointer(once, '@Foo', 'short', 'vidS', '2024-01-02');
    const [row] = parseState(twice);
    expect(row!.last_longform_id).toBe('vid123');
    expect(row!.last_short_id).toBe('vidS');
    expect(row!.session).toBe(2); // unchanged: updated already equals the date
  });

  it('throws when the channel row is missing', () => {
    expect(() => bumpStatePointer(base, '@Missing', 'live', 'x', '2024-01-02')).toThrow();
  });
});

describe('profile section writers', () => {
  const profile = ['# @Foo — Profile', ''].join('\n');

  it('appendSkipTitle creates the section and formats the bullet', () => {
    const out = appendSkipTitle(profile, { title: 'Clickbait', type: 'longform' });
    expect(out).toContain(SKIP_TITLES_HEADING);
    expect(out).toContain('- "Clickbait" — longform');
  });

  it('is a no-op on an identical bullet (dedup)', () => {
    const once = appendSkipTitle(profile, { title: 'Clickbait', type: 'longform' });
    const twice = appendSkipTitle(once, { title: 'Clickbait', type: 'longform' });
    expect(twice).toBe(once);
  });

  it('FIFO-caps a section', () => {
    let p = profile;
    p = appendToSection(p, SKIP_TITLES_HEADING, '- a', 2);
    p = appendToSection(p, SKIP_TITLES_HEADING, '- b', 2);
    p = appendToSection(p, SKIP_TITLES_HEADING, '- c', 2);
    expect(p).not.toContain('- a');
    expect(p).toContain('- b');
    expect(p).toContain('- c');
  });

  it('appendNote writes under Notes', () => {
    const out = appendNote(profile, 'skip shorts');
    expect(out).toContain(NOTES_HEADING);
    expect(out).toContain('- skip shorts');
  });
});

describe('isResolved', () => {
  it('true when the state pointer already landed on the video', () => {
    expect(isResolved('vid1', 'vid1', [])).toBe(true);
  });

  it('true when the video is in seen even if the pointer regressed (the --fill race)', () => {
    // A stale --fill bump left the pointer on an OLDER video (pointer !== id), but the
    // rating already marked this one seen → it must STILL count as resolved (no re-emit).
    expect(isResolved('older-vid', 'vid1', ['vid1'])).toBe(true);
    expect(isResolved(null, 'vid1', ['vid1'])).toBe(true);
  });

  it('false when neither the pointer nor seen knows the video', () => {
    expect(isResolved('older-vid', 'vid1', ['other'])).toBe(false);
    expect(isResolved(null, 'vid1', [])).toBe(false);
  });
});
