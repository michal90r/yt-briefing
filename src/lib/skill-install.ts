/**
 * skill-install — place this package's SKILL.md files into a coding agent's skills directory.
 *
 * Shared by the onboarding wizard (`bootstrap.ts`, final step) and the standalone
 * `install-skill.ts` command, so both write the skills identically.
 *
 * The package ships TWO skills, each at `.claude/skills/<name>/SKILL.md`:
 *   yt            — the recurring channel briefing loop (sweep + rate).
 *   yt-transcribe — one-shot: a single video's transcript → summary.
 * Both are installed together so an agent gets the whole toolset in one step.
 *
 * The shipped SKILL.md files use `bun run src/X.ts` — the dev shortcut: it works when the
 * agent's cwd IS the package folder AND the runtime is Bun (which runs TypeScript directly).
 * That's true for the publisher's own day-to-day use, so it stays the default.
 *
 * For everyone else — a Node user, or any install whose cwd won't be the package — we rewrite to
 * a PORTABLE command: `<runtime> "<project-relative>/dist/X.js"`. The runtime is the bare name
 * (`node`/`bun`) resolved from PATH, never an absolute binary; the script and `data/` paths are
 * relative to the PROJECT ROOT, never machine-absolute. The invariant this rests on is the same
 * one the whole package already relies on (paths.ts derives BASE_DIR/DATA_DIR from
 * `process.cwd()` when consumed): the agent runs from the project root. So the rewritten skill is
 * machine-independent — it survives being committed to git and shared across machines (e.g. a
 * Mac dev box and a Linux VPS), which an absolute `process.execPath`/`<abs>/dist` baking did not.
 * (Requires `dist/` — build once with `bun run build` / `npm run build`.)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { PKG_ROOT, BASE_DIR, DATA_DIR } from './paths.ts';

/** Compiled output dir — what a rewritten (dist) skill command points the runtime at. */
const DIST_DIR = join(PKG_ROOT, 'dist');

/** Consumed as a dependency? Then PKG_ROOT lives under node_modules (mirrors paths.ts). */
const CONSUMED = PKG_ROOT.split(sep).includes('node_modules');

/**
 * The project root the agent runs from — the cwd against which the rewritten skill's relative
 * paths resolve. When consumed, that's the user's project (parent of `<project>/.yt-briefing`);
 * in a clone it's the package itself. Matches how paths.ts picks BASE_DIR.
 */
const PROJECT_ROOT = CONSUMED ? dirname(BASE_DIR) : PKG_ROOT;

/** An absolute path expressed relative to PROJECT_ROOT, with POSIX `/` (portable on Windows too). */
const toProjectRel = (abs: string): string => relative(PROJECT_ROOT, abs).split(sep).join('/');

/** The skills this package ships — each lives at `.claude/skills/<name>/SKILL.md`. */
export const SKILLS = ['yt', 'yt-transcribe', 'yt-search'] as const;

/** True when the installer itself is running under Bun (vs plain Node). */
export const isBun: boolean = (process.versions as { bun?: string }).bun != null;

/**
 * The shipped `bun run src/X.ts` command is only correct in ONE situation: the publisher
 * developing *inside the package clone* under Bun (cwd === package, TypeScript runs directly,
 * no build). Everywhere else — and crucially when the package is consumed as a dependency, so
 * the engine lives in node_modules while the user works in their own project — we must bake the
 * compiled `dist/` command instead. This detects that one dev-in-clone case.
 */
export const isPackageDevCwd = (): boolean => isBun && resolve(process.cwd()) === PKG_ROOT;

/** Source path of a shipped skill's SKILL.md, by skill name. */
export const skillSource = (name: string): string =>
  join(PKG_ROOT, '.claude', 'skills', name, 'SKILL.md');

/**
 * Agent key → display name + the skills ROOT directory it scans (skills install under it).
 *
 * SKILL.md is the cross-agent Agent Skills standard (Anthropic, Dec 2025), now read by 30+
 * tools that each scan their own `<agent-home>/skills/` dir. We only need the right directory
 * per agent — the shipped SKILL.md works unmodified in all of them. The "custom folder" picker
 * option (no AGENTS entry) covers every other compatible agent (Gemini CLI, Copilot, Windsurf…)
 * and defaults to the neutral `.agents/skills/` location.
 */
export const AGENTS: Record<string, { name: string; sub: string }> = {
  '1': { name: 'Claude Code', sub: join('.claude', 'skills') },
  '2': { name: 'Cursor',      sub: join('.cursor', 'skills') },
  '3': { name: 'Codex',       sub: join('.codex', 'skills') },
};

/**
 * One shipped skill's SKILL.md. `dist=false` (default) returns it verbatim — the
 * `bun run src/X.ts` dev form, correct only when cwd is the package AND the runtime is Bun.
 * `dist=true` rewrites for the consumed case into PORTABLE, project-relative form: engine
 * commands become `<node|bun> "<rel>/dist/X.js"` (bare runtime from PATH + a path relative to the
 * project root, so they run on any machine from the project cwd), and the bare `data/…` paths the
 * agent reads (e.g. `data/config.json`) become the project-relative DATA_DIR (`.yt-briefing/data/`
 * when consumed). Nothing machine-absolute is baked, so the rewritten skill can be committed and
 * shared across machines. The runtime name follows whoever runs the installer (Node→`node`,
 * Bun→`bun`); the compiled `dist/` build runs under either.
 */
export function skillBody(name: string, dist = false): string {
  const raw = readFileSync(skillSource(name), 'utf8');
  if (!dist) return raw;
  const runtime = isBun ? 'bun' : 'node';
  const cmd = (base: string): string => `${runtime} "${toProjectRel(join(DIST_DIR, base + '.js'))}"`;
  return raw
    .replace(/bun run src\/yt-sweep\.ts/g, cmd('yt-sweep'))
    .replace(/bun run src\/yt-rating\.ts/g, cmd('yt-rating'))
    .replace(/bun run src\/yt-transcript\.ts/g, cmd('yt-transcript'))
    .replace(/bun run src\/yt-search\.ts/g, cmd('yt-search'))
    .replace(/data\//g, toProjectRel(DATA_DIR) + '/');
}

/**
 * Write every shipped skill into `root`, each under its own `<name>/SKILL.md` subdir
 * (created if needed). Returns the SKILL.md paths written, in `SKILLS` order.
 */
export function installSkills(root: string, dist = false): string[] {
  return SKILLS.map((name) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, 'SKILL.md');
    writeFileSync(target, skillBody(name, dist), 'utf8');
    return target;
  });
}

/** Agent key of Claude Code in AGENTS — the only agent with a PreToolUse hook to gate on. */
export const CLAUDE_CODE = '1';

/** Substring identifying our gate inside a settings.json hook command (used to update in place). */
const GATE_ID = 'yt-summary-gate';

/**
 * How settings.json must invoke the gate. Like the skill's engine commands it bakes nothing
 * machine-absolute, but a hook may NOT assume its cwd — Claude Code's hooks reference states the
 * working directory can vary, so a bare relative path would fail open, silently and invisibly
 * (the rating is written ungated, which is exactly the bug the gate exists to catch). Hence the
 * `$CLAUDE_PROJECT_DIR` prefix: still just a placeholder string in the committed JSON, resolved
 * to the project root at hook time.
 */
export const gateCommand = (dist = false): string =>
  dist
    ? `${isBun ? 'bun' : 'node'} "\${CLAUDE_PROJECT_DIR}/${toProjectRel(join(DIST_DIR, GATE_ID + '.js'))}"`
    : `bun run src/${GATE_ID}.ts`;

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string }[] };
export type Settings = { hooks?: { PreToolUse?: HookEntry[] } };

/**
 * Put the gate into a settings object: a PreToolUse hook on Bash, which is where the rating is
 * written (gating the popup instead cannot work — see src/yt-summary-gate.ts). Merges — every
 * other setting and hook is left as found, and our own entry is updated in place, so
 * reinstalling (or upgrading from the pre-0.15.0 AskUserQuestion matcher) never duplicates or
 * clobbers anything.
 */
export function withGateHook(settings: Settings, command: string): Settings {
  const preToolUse = ((settings.hooks ??= {}).PreToolUse ??= []);
  const mine = preToolUse.find((e) => e.hooks?.some((h) => h.command?.includes(GATE_ID)));
  const entry: HookEntry = { matcher: 'Bash', hooks: [{ type: 'command', command }] };
  if (mine) Object.assign(mine, entry);
  else preToolUse.push(entry);
  return settings;
}

/**
 * Register the gate in a Claude Code project's `.claude/settings.json`.
 *
 * Returns the settings path written, or null when the file exists but isn't parseable JSON: a
 * hand-edited config is not ours to rewrite, so the caller tells the user to add it by hand.
 */
export function installClaudeGate(projectDir: string, dist = false): string | null {
  const target = join(projectDir, '.claude', 'settings.json');
  let settings: Settings = {};
  if (existsSync(target)) {
    try {
      settings = JSON.parse(readFileSync(target, 'utf8')) as Settings;
    } catch {
      return null;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(withGateHook(settings, gateCommand(dist)), null, 2) + '\n', 'utf8');
  return target;
}

/** The agent's skills ROOT inside a project folder (the project you open in the agent). */
export const projectSkillsRoot = (agentKey: string, projectDir: string): string =>
  join(projectDir, AGENTS[agentKey].sub);

/** Suggested target for a "custom" (any other agent) install — the open `.agents` convention,
 *  rooted at the user's current project (not the package, which may be in node_modules). */
export const customSkillsRootDefault = (): string =>
  join(process.cwd(), '.agents', 'skills');
