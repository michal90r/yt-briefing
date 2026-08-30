// The summary gate is what stops a rating being recorded against a summary the user never saw
// (see src/yt-summary-gate.ts). Two things must hold: it recognises the rating WRITE and nothing
// else — it is matched on Bash, so it sees every shell command in the session — and it only
// accepts the assistant's own text as proof the summary was shown; an id travelling through a
// tool call or its result is invisible to the user.
// Pure logic only, no disk access — same hermetic style as the rest of tests/.
// Globals only — runs under vitest and bun test.
import { isRatingWrite, summaryWasPasted } from '../src/lib/summary-gate.ts';
import { withGateHook, gateCommand, type Settings } from '../src/lib/skill-install.ts';

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

describe('isRatingWrite', () => {
  it('recognises the rating write the skill issues', () => {
    expect(isRatingWrite(bash('bun "node_modules/yt-briefing/dist/yt-rating.js" --rating 1'))).toBe(true);
    expect(isRatingWrite(bash('node dist/yt-rating.js --rating 0 --comment "skip shorts"'))).toBe(true);
    expect(isRatingWrite(bash('bun run src/yt-rating.ts --rating 1'))).toBe(true);
  });

  it('waves through the rest of the loop and any unrelated shell work', () => {
    // Matched on Bash, so it is asked about every command in the session — it must be cheap and
    // decline fast on all of them.
    expect(isRatingWrite(bash('bun "node_modules/yt-briefing/dist/yt-sweep.js" --reset'))).toBe(false);
    expect(isRatingWrite(bash('bun dist/yt-transcript.js abc123 --lang auto'))).toBe(false);
    expect(isRatingWrite(bash('git status'))).toBe(false);
    expect(isRatingWrite(bash('echo --rating 1'))).toBe(false); // no yt-rating script
    expect(isRatingWrite(bash('cat dist/yt-rating.js'))).toBe(false); // reading it is not writing
  });

  it('ignores every other tool (the popup included — gating it cannot work)', () => {
    expect(isRatingWrite({ tool_name: 'AskUserQuestion', tool_input: {} })).toBe(false);
    expect(isRatingWrite({ tool_name: 'Edit', tool_input: { command: 'yt-rating --rating 1' } })).toBe(false);
    expect(isRatingWrite({})).toBe(false);
  });
});

describe('withGateHook', () => {
  const entries = (s: Settings) => s.hooks?.PreToolUse ?? [];

  it('adds a PreToolUse hook on Bash to empty settings (the rating write, not the popup)', () => {
    const s = withGateHook({}, 'node gate.js');
    expect(entries(s)).toHaveLength(1);
    expect(entries(s)[0].matcher).toBe('Bash');
    expect(entries(s)[0].hooks?.[0]).toEqual({ type: 'command', command: 'node gate.js' });
  });

  it("leaves the user's other hooks in place", () => {
    const s = withGateHook(
      { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'git pull' }] }] } },
      'node gate.js',
    );
    expect(entries(s)).toHaveLength(2);
    expect(entries(s)[0].hooks?.[0].command).toBe('git pull');
  });

  it('updates its own entry in place instead of duplicating it', () => {
    let s = withGateHook({}, gateCommand(false));
    s = withGateHook(s, gateCommand(false));
    s = withGateHook(s, 'node moved/yt-summary-gate.js');
    expect(entries(s)).toHaveLength(1);
    expect(entries(s)[0].hooks?.[0].command).toBe('node moved/yt-summary-gate.js');
  });

  it('re-points a pre-0.15.0 install from the popup to the rating write', () => {
    // Upgrading must not leave the old AskUserQuestion entry behind: it would block every popup.
    const stale = {
      hooks: {
        PreToolUse: [
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'node dist/yt-summary-gate.js' }] },
        ],
      },
    };
    const s = withGateHook(stale, 'node dist/yt-summary-gate.js');
    expect(entries(s)).toHaveLength(1);
    expect(entries(s)[0].matcher).toBe('Bash');
  });
});

describe('gateCommand', () => {
  it('bakes no machine-absolute path (the settings file gets committed and shared)', () => {
    expect(gateCommand(true)).not.toMatch(/"\/[^"]*\.js"/);
    expect(gateCommand(true)).not.toMatch(/"[A-Za-z]:\\[^"]*"/);
    expect(gateCommand(true)).not.toContain(process.execPath);
  });

  it('points at the compiled gate when baking for a consumer', () => {
    expect(gateCommand(true)).toMatch(/(node|bun) "[^"\n]*dist\/yt-summary-gate\.js"/);
  });

  it('anchors the path so it cannot depend on the hook\'s cwd (a hook may run anywhere)', () => {
    expect(gateCommand(true)).toContain('"${CLAUDE_PROJECT_DIR}/');
  });
});
