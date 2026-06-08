// Pure-logic smoke tests for src/lib/paths.ts — path resolution only (no disk access). Assertions
// are separator-agnostic (substring / filename), so they hold on macOS, Linux and Windows.
// Globals only — runs under vitest (Node) and bun test (Bun).
import { profilePath, script } from '../src/lib/paths.ts';

describe('profilePath', () => {
  it('points at channels/<slug>.md', () => {
    const p = profilePath('better-stack');
    expect(p.endsWith('better-stack.md')).toBe(true);
    expect(p).toContain('channels');
  });
});

describe('script', () => {
  it('resolves a sibling engine script with the build extension', () => {
    const p = script('yt-sweep');
    // '.ts' running from source, '.js' once compiled to dist/ — accept either.
    expect(p).toMatch(/yt-sweep\.(ts|js)$/);
  });
});
