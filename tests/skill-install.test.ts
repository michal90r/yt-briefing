// Regression guard for src/lib/skill-install.ts — the `dist=true` rewrite must stay PORTABLE:
// no machine-absolute paths (no `process.execPath`, no `<abs>/dist`, no absolute DATA_DIR) may be
// baked into a SKILL.md, or the installed skill breaks the moment it's run on another machine
// (e.g. committed on a Mac, run on a Linux VPS). Globals only — runs under vitest and bun test.
import { skillBody, SKILLS, isBun } from '../src/lib/skill-install.ts';

describe('skillBody(dist=true) — portable rewrite', () => {
  for (const name of SKILLS) {
    describe(name, () => {
      const body = skillBody(name, true);

      it('bakes no absolute path in an engine command', () => {
        // Engine calls quote the script path: `<runtime> "<path>/X.js"`. A leaked absolute would
        // show as a quoted path starting at a root. (Targets the rewrite site, not prose like the
        // skill's legit mention of `/tmp` — which is not a quoted .js path.)
        expect(body).not.toMatch(/"\/[^"]*\.js"/);            // "/Users/…/dist/X.js"
        expect(body).not.toMatch(/"[A-Za-z]:\\[^"]*"/);       // "C:\…\dist\X.js"
      });

      it('bakes no absolute path to a state file the agent reads', () => {
        // The `data/` → DATA_DIR rewrite must stay project-relative; a leaked absolute would put a
        // root in front of these files (e.g. `/Users/…/data/config.json`).
        // The leading `/` must be at a token boundary (a real root) — an internal slash in a
        // relative path like `data/.cache/pending.json` is fine and must not trip this.
        expect(body).not.toMatch(/(^|[\s`"(])\/[^\s`"]*\/(config\.json|state\.md|pending\.json)/m);
      });

      it('does not bake the installer runtime binary (process.execPath)', () => {
        expect(body).not.toContain(process.execPath);
      });

      it('invokes the engine via a bare runtime name from PATH', () => {
        const runtime = isBun ? 'bun' : 'node';
        // every engine call is `<runtime> "<rel>/X.js"` — at least one must be present.
        expect(body).toMatch(new RegExp(`${runtime} "[^"\\n]*dist/yt-\\w+\\.js"`));
      });

      it('still replaces the dev `bun run src/…` form', () => {
        expect(body).not.toContain('bun run src/');
      });
    });
  }
});

describe('skillBody(dist=false) — verbatim dev form', () => {
  it('returns the shipped `bun run src/…` command untouched', () => {
    expect(skillBody('yt', false)).toContain('bun run src/yt-sweep.ts');
  });
});
