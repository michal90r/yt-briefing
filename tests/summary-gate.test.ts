// The summary gate is what stops a rating being recorded against a summary the user never saw
// (see src/yt-summary-gate.ts). Two things must hold: it recognises the rating popup and nothing
// else, and it only accepts the assistant's own text as proof the summary was shown — an id
// travelling through a tool call or its result is invisible to the user.
// Pure logic only, no disk access — same hermetic style as the rest of tests/.
// Globals only — runs under vitest and bun test.
import { isRatingPopup, summaryWasPasted } from '../src/lib/summary-gate.ts';
import { withGateHook, gateCommand, type Settings } from '../src/lib/skill-install.ts';

const popup = (...labels: string[]) => ({
  tool_input: { questions: [{ options: labels.map((label) => ({ label })) }] },
});

describe('isRatingPopup', () => {
  it('recognises the rating popup by its pinned labels', () => {
    expect(isRatingPopup(popup('OK', 'Weak', 'Research'))).toBe(true);
  });

  it('tolerates case and padding (the labels are typed by an agent)', () => {
    expect(isRatingPopup(popup(' ok ', 'weak', ' RESEARCH'))).toBe(true);
  });

  it('ignores /yt-search triage and any other question', () => {
    expect(isRatingPopup(popup('Keep', 'Skip'))).toBe(false);
    expect(isRatingPopup(popup('Yes', 'No'))).toBe(false);
    expect(isRatingPopup({})).toBe(false);
  });
});

describe('summaryWasPasted', () => {
  const id = 'dQw4w9WgXcQ';
  const line = (o: unknown) => JSON.stringify(o);

  it('accepts an assistant text block carrying the video id', () => {
    const t = line({ message: { role: 'assistant', content: [{ type: 'text', text: `watch?v=${id}` }] } });
    expect(summaryWasPasted(t, id)).toBe(true);
  });

  it('rejects a transcript where the id only rode in on a tool call', () => {
    const t = [
      line({ message: { role: 'assistant', content: [{ type: 'tool_use', input: { command: `sweep ${id}` } }] } }),
      line({ message: { role: 'user', content: [{ type: 'tool_result', content: `summary of ${id}` }] } }),
    ].join('\n');
    expect(summaryWasPasted(t, id)).toBe(false);
  });

  it('rejects an empty or unrelated transcript, and survives malformed lines', () => {
    expect(summaryWasPasted('', id)).toBe(false);
    expect(summaryWasPasted(`{not json ${id}}\n`, id)).toBe(false);
    const other = line({ message: { role: 'assistant', content: [{ type: 'text', text: 'watch?v=abc' }] } });
    expect(summaryWasPasted(other, id)).toBe(false);
  });
});

describe('withGateHook', () => {
  const entries = (s: Settings) => s.hooks?.PreToolUse ?? [];

  it('adds a PreToolUse hook on AskUserQuestion to empty settings', () => {
    const s = withGateHook({}, 'node gate.js');
    expect(entries(s)).toHaveLength(1);
    expect(entries(s)[0].matcher).toBe('AskUserQuestion');
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
