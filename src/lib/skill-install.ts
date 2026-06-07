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
 * For everyone else — a Node user, or any install whose cwd won't be the package — we bake an
 * absolute, runtime-correct command instead: `"<this runtime>" "<abs>/dist/X.js"`. The runtime
 * is `process.execPath` of whoever runs the installer (so `init` under Node bakes node, under
 * Bun bakes bun), and it points at the compiled build, so it runs from any cwd. The engine
 * resolves data/.env from its own location regardless. (Requires `dist/` — build once with
 * `bun run build` / `npm run build`; that's exactly how a Node user already got here.)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PKG_ROOT, DATA_DIR } from './paths.ts';

/** Compiled output dir — what a baked (dist) skill command points the runtime at. */
const DIST_DIR = join(PKG_ROOT, 'dist');

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
 * `dist=true` rewrites for the consumed case: engine commands become
 * `"<process.execPath>" "<abs>/dist/X.js"` (this machine's runtime, Node or Bun, against the
 * compiled build, so they run from any cwd), and the bare `data/…` paths the agent reads (e.g.
 * `data/config.json`) become the absolute `DATA_DIR`. In dev the agent's cwd IS the package so
 * `data/` resolves; when consumed, DATA_DIR moves to `<project>/.yt-briefing/data`, so the
 * dev-relative paths would miss — hence the rewrite.
 */
export function skillBody(name: string, dist = false): string {
  const raw = readFileSync(skillSource(name), 'utf8');
  if (!dist) return raw;
  const exe = process.execPath;
  const cmd = (base: string): string => `"${exe}" "${join(DIST_DIR, base + '.js')}"`;
  return raw
    .replace(/bun run src\/yt-sweep\.ts/g, cmd('yt-sweep'))
    .replace(/bun run src\/yt-rating\.ts/g, cmd('yt-rating'))
    .replace(/bun run src\/yt-transcript\.ts/g, cmd('yt-transcript'))
    .replace(/bun run src\/yt-search\.ts/g, cmd('yt-search'))
    .replace(/data\//g, DATA_DIR + '/');
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

/** The agent's skills ROOT inside a project folder (the project you open in the agent). */
export const projectSkillsRoot = (agentKey: string, projectDir: string): string =>
  join(projectDir, AGENTS[agentKey].sub);

/** Suggested target for a "custom" (any other agent) install — the open `.agents` convention,
 *  rooted at the user's current project (not the package, which may be in node_modules). */
export const customSkillsRootDefault = (): string =>
  join(process.cwd(), '.agents', 'skills');
