// Pure-logic tests for the Claude Code backend (src/lib/llm.ts) and comment distillation
// (src/lib/distill.ts). No subprocess is started: only argv, env and output parsing are checked.
// Globals only — runs under vitest (Node) and bun test (Bun).
import { claudeArgs, childEnv, parseClaudeOutput, getModel, DEFAULT_MODEL } from '../src/lib/llm.ts';
import { parseDistilled, distillPrompt } from '../src/lib/distill.ts';

describe('claudeArgs — a bare one-shot run', () => {
  const args = claudeArgs({ system: 'sys' });

  it('prints one answer as JSON', () => {
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json']));
  });

  it('loads no tools, settings (hooks) or MCP servers, and keeps no session', () => {
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
  });

  it('passes the system prompt and the model', () => {
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('sys');
    expect(claudeArgs({ model: 'opus' })).toEqual(expect.arrayContaining(['--model', 'opus']));
  });

  it('defaults to sonnet, overridable with YT_BRIEFING_MODEL', () => {
    delete process.env.YT_BRIEFING_MODEL;
    expect(getModel()).toBe(DEFAULT_MODEL);
    process.env.YT_BRIEFING_MODEL = 'opus';
    expect(getModel()).toBe('opus');
    delete process.env.YT_BRIEFING_MODEL;
  });
});

describe('childEnv', () => {
  it('drops ANTHROPIC_API_KEY so the run uses the Claude Code login', () => {
    const env = childEnv({ ANTHROPIC_API_KEY: 'sk-x', PATH: '/bin' });
    expect(env).toEqual({ PATH: '/bin' });
  });
});

describe('parseClaudeOutput', () => {
  it('returns the trimmed result', () => {
    expect(parseClaudeOutput(JSON.stringify({ result: '  hi \n', is_error: false }))).toBe('hi');
  });

  it("throws with Claude Code's own error text", () => {
    expect(() => parseClaudeOutput(JSON.stringify({ result: 'Not logged in', is_error: true }))).toThrow('Not logged in');
  });

  it('throws on output that is not JSON', () => {
    expect(() => parseClaudeOutput('boom')).toThrow('unreadable');
  });
});

describe('parseDistilled', () => {
  it('reads the rule and rating', () => {
    expect(parseDistilled('{"rating":0,"rule":"Skip panel shows."}')).toEqual({ rating: 0, rule: 'Skip panel shows.' });
  });

  it('tolerates prose around the JSON', () => {
    expect(parseDistilled('Here: {"rating":1,"rule":"Keep interviews."} done')).toEqual({ rating: 1, rule: 'Keep interviews.' });
  });

  it('rejects a missing rule or an out-of-range rating', () => {
    expect(parseDistilled('{"rating":1,"rule":""}')).toBeNull();
    expect(parseDistilled('{"rating":3,"rule":"x"}')).toBeNull();
    expect(parseDistilled('no json')).toBeNull();
  });

  it('puts the comment and the video in the prompt', () => {
    const p = distillPrompt('too long', { channel: '@c', title: 'T', type: 'short' });
    expect(p).toContain('too long');
    expect(p).toContain('@c');
    expect(p).toContain('"T"');
  });
});
