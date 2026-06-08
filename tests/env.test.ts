// Pure-logic smoke tests for src/lib/env.ts — missing-variable filtering and the error message.
// Importing env.ts does NOT read disk (dotenv only runs inside loadEnv(), which we never call).
// Globals only — runs under vitest (Node) and bun test (Bun).
import { missingEnv, missingEnvMessage } from '../src/lib/env.ts';

describe('missingEnv', () => {
  it('reports a variable that is not set', () => {
    delete process.env.__YT_SMOKE_UNSET__;
    expect(missingEnv(['__YT_SMOKE_UNSET__'])).toEqual(['__YT_SMOKE_UNSET__']);
  });

  it('omits a variable that is set', () => {
    process.env.__YT_SMOKE_SET__ = 'x';
    expect(missingEnv(['__YT_SMOKE_SET__'])).toEqual([]);
    delete process.env.__YT_SMOKE_SET__;
  });

  it('treats an empty value as missing', () => {
    process.env.__YT_SMOKE_EMPTY__ = '';
    expect(missingEnv(['__YT_SMOKE_EMPTY__'])).toEqual(['__YT_SMOKE_EMPTY__']);
    delete process.env.__YT_SMOKE_EMPTY__;
  });

  it('preserves order of missing names', () => {
    expect(missingEnv(['__YT_A__', '__YT_B__'])).toEqual(['__YT_A__', '__YT_B__']);
  });
});

describe('missingEnvMessage', () => {
  it('is singular for one variable and names it', () => {
    const msg = missingEnvMessage(['FOO']);
    expect(msg).toContain('variable:');
    expect(msg).toContain('FOO');
    expect(msg).not.toContain('variables:');
  });

  it('is plural for several variables', () => {
    const msg = missingEnvMessage(['FOO', 'BAR']);
    expect(msg).toContain('variables:');
    expect(msg).toContain('FOO, BAR');
    expect(msg).toContain('them');
  });
});
