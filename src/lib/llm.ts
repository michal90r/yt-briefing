/**
 * The one LLM call in yt-briefing — a headless Claude Code run (`claude -p`).
 *
 * There is no API key and no provider to configure: the engine asks the `claude` CLI already
 * installed and logged in on this machine, so title filtering, summaries and search all run on
 * the user's Claude Code login (subscription or whatever auth they set up for it).
 *
 * The run is deliberately bare of everything that makes Claude Code an agent: no tools, no
 * settings sources (so none of the project's hooks or permissions), no MCP servers, no session
 * file. It is a single prompt in, a single answer out — the same contract the old
 * OpenAI-compatible client had.
 *
 * `ANTHROPIC_API_KEY` is removed from the child's environment: when it is set, Claude Code
 * prefers it over the interactive login, which silently turns every summary into paid API usage
 * (or a "credit balance too low" failure). The briefing is meant to run on the login.
 *
 * Env (all optional):
 *   YT_BRIEFING_MODEL   model alias or full name passed to `claude --model` (default: haiku)
 */

import { spawn, spawnSync } from 'node:child_process';

/** Model alias for every call; one model does both stages, as before. */
export const DEFAULT_MODEL = 'haiku';

export function getModel(): string {
  return process.env.YT_BRIEFING_MODEL || DEFAULT_MODEL;
}

/** A hung CLI must not hold the sweep forever; a long transcript summary takes well under this. */
const TIMEOUT_MS = 5 * 60_000;

export interface ChatOptions {
  model?: string;  // overrides YT_BRIEFING_MODEL
  system?: string; // system prompt (replaces Claude Code's own)
}

/** The child environment: everything but the API key that would override the login. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _drop, ...rest } = env;
  return rest;
}

/** argv for one bare, tool-less, settings-less `claude -p` call. */
export function claudeArgs(opts: ChatOptions = {}): string[] {
  const args = [
    '-p',
    '--model', opts.model || getModel(),
    '--output-format', 'json',
    '--tools', '',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (opts.system) args.push('--system-prompt', opts.system);
  return args;
}

/** Pull the answer out of `--output-format json`; throws with Claude Code's own error text. */
export function parseClaudeOutput(stdout: string): string {
  let data: { result?: unknown; is_error?: boolean };
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error(`claude: unreadable output: ${stdout.slice(0, 300)}`);
  }
  if (data.is_error || typeof data.result !== 'string') {
    throw new Error(`claude: ${String(data.result ?? 'no result').slice(0, 300)}`);
  }
  return data.result.trim();
}

export async function chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs(opts), { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude: no answer within ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude: cannot start (${e.message})`)); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(parseClaudeOutput(out));
      } catch (e) {
        reject(out.trim() ? e : new Error(`claude: ${err.trim().slice(0, 300) || 'no output'}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/**
 * Preflight for the entrypoints: null when the `claude` CLI runs, else a message saying what to
 * install. Checked once per foreground run, so a missing CLI is a named error instead of every
 * summary failing (and the title filter silently keeping everything).
 */
export function claudeMissing(): string | null {
  const res = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (!res.error && res.status === 0) return null;
  return 'Claude Code CLI not found: yt-briefing runs its filters and summaries through `claude -p`. ' +
    'Install Claude Code (https://claude.com/claude-code), log in once, and make sure `claude` is on PATH.';
}
