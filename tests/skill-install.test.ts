// Regression guard for src/lib/skill-install.ts — the `dist=true` rewrite must stay PORTABLE:
// no machine-absolute paths (no `process.execPath`, no `<abs>/dist`, no absolute DATA_DIR) may be
// baked into a SKILL.md or the mod's engine map, or the install breaks the moment it's run on
// another machine (e.g. committed on a Mac, run on a Linux VPS). Globals only — runs under vitest
// and bun test.
import { skillBody, engineModule, withoutGateHook, SKILLS, isBun, type Settings } from '../src/lib/skill-install.ts';

describe('skillBody(dist=true) — portable rewrite', () => {
  for (const name of SKILLS) {
    describe(name, () => {
      const body = skillBody(name, true);

      it('bakes no absolute path in an engine command', () => {
        // Engine calls quote the script path: `<runtime> "<path>/X.js"`. A leaked absolute would
        // show as a quoted path starting at a root.
        expect(body).not.toMatch(/"\/[^"]*\.js"/);            // "/Users/…/dist/X.js"
        expect(body).not.toMatch(/"[A-Za-z]:\\[^"]*"/);       // "C:\…\dist\X.js"
      });

      it('does not bake the installer runtime binary (process.execPath)', () => {
        expect(body).not.toContain(process.execPath);
      });

      it('invokes the engine via a bare runtime name from PATH', () => {
        const runtime = isBun ? 'bun' : 'node';
        expect(body).toMatch(new RegExp(`${runtime} "[^"\\n]*dist/yt-\\w+\\.js"`));
      });

      it('still replaces the dev `bun run src/…` form', () => {
        expect(body).not.toContain('bun run src/');
      });
    });
  }
});

describe('engineModule — the mod\'s engine map', () => {
  it('dev form is the shipped `bun src/…` map', () => {
    expect(engineModule(false)).toContain("['bun', `src/${name}.ts`]");
  });

  it('dist form runs dist/ with a bare runtime and a project-relative path', () => {
    const mod = engineModule(true);
    const runtime = isBun ? 'bun' : 'node';
    expect(mod).toContain(`['${runtime}', \``);
    expect(mod).toMatch(/dist\/\$\{name\}\.js`/);
    expect(mod).not.toContain(process.execPath);
    expect(mod).not.toMatch(/`\/[^`]*dist/);              // `/Users/…/dist
  });
});

describe('withoutGateHook — 0.x cleanup', () => {
  const gate = { matcher: 'Bash', hooks: [{ type: 'command', command: 'bun "${CLAUDE_PROJECT_DIR}/node_modules/yt-briefing/dist/yt-summary-gate.js"' }] };
  const other = { matcher: '*', hooks: [{ type: 'command', command: 'git pull' }] };

  it('drops the gate and keeps every other hook', () => {
    const s: Settings = { hooks: { PreToolUse: [other, gate], PostToolUse: [other] } };
    expect(withoutGateHook(s)).toEqual({ hooks: { PreToolUse: [other], PostToolUse: [other] } });
  });

  it('removes an emptied PreToolUse and an emptied hooks block', () => {
    expect(withoutGateHook({ hooks: { PreToolUse: [gate] } })).toEqual({});
  });

  it('leaves settings without the gate untouched', () => {
    const s: Settings = { hooks: { PreToolUse: [other] } };
    expect(withoutGateHook(s)).toEqual({ hooks: { PreToolUse: [other] } });
  });
});
