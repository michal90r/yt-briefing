/**
 * skill-install — put yt-briefing into a Claude Code project.
 *
 * Shared by the onboarding wizard (`bootstrap.ts`, final step) and the standalone
 * `install-skill.ts` command, so both install identically. Two things land in
 * `<project>/.claude/skills/`:
 *
 *   yt-briefing/   the Claude Code mod (a plugin of function hooks) behind `/yt`: the rating loop
 *                  in the chat. Claude Code loads a plugin from the project's skills folder by itself
 *                  (as `yt-briefing@skills-dir`) once the workspace is trusted.
 *   yt-transcribe/ one-shot skill: a single video's transcript → summary.
 *   yt-search/     skill: search within one channel → triage → comparison.
 *
 * The shipped files use the dev form (`bun run src/X.ts`, or `bun src/X.ts` in the mod): correct
 * only when the agent's cwd IS the package clone AND the runtime is Bun. For every other install —
 * a Node user, or the package consumed as a dependency — they are rewritten to a PORTABLE command:
 * `<runtime> "<project-relative>/dist/X.js"`, the runtime a bare name from PATH and every path
 * relative to the project root, never machine-absolute. The invariant this rests on is the one the
 * whole package relies on (paths.ts derives BASE_DIR/DATA_DIR from `process.cwd()` when consumed):
 * Claude Code runs from the project root. So the installed files survive being committed to git and
 * shared across machines (a Mac and a Linux VPS). (Requires `dist/` — `bun run build`.)
 *
 * Upgrading from 0.x also removes what 1.0 replaced: the old chat-driven `/yt` skill and the
 * summary-gate PreToolUse hook in `.claude/settings.json`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { PKG_ROOT, BASE_DIR, DATA_DIR } from './paths.ts';

/** Compiled output dir — what a rewritten (dist) command points the runtime at. */
const DIST_DIR = join(PKG_ROOT, 'dist');

/** Consumed as a dependency? Then PKG_ROOT lives under node_modules (mirrors paths.ts). */
const CONSUMED = PKG_ROOT.split(sep).includes('node_modules');

/**
 * The project root Claude Code runs from — the cwd against which the rewritten relative paths
 * resolve. When consumed, that's the user's project (parent of `<project>/.yt-briefing`); in a
 * clone it's the package itself. Matches how paths.ts picks BASE_DIR.
 */
const PROJECT_ROOT = CONSUMED ? dirname(BASE_DIR) : PKG_ROOT;

/** An absolute path expressed relative to PROJECT_ROOT, with POSIX `/` (portable on Windows too). */
const toProjectRel = (abs: string): string => relative(PROJECT_ROOT, abs).split(sep).join('/');

/** The skills this package ships — each lives at `.claude/skills/<name>/SKILL.md`. */
export const SKILLS = ['yt-transcribe', 'yt-search'] as const;

/** The mod's folder name under `.claude/skills/` (and its plugin name). */
export const PLUGIN = 'yt-briefing';

/** The mod's shipped files, relative to `plugin/`; `hooks/engine.ts` is written, not copied. */
export const PLUGIN_FILES = [
  '.claude-plugin/plugin.json',
  'hooks/hooks.json',
  'hooks/register.tsx',
  'types/index.d.ts',
] as const;

/** True when the installer itself is running under Bun (vs plain Node). */
export const isBun: boolean = (process.versions as { bun?: string }).bun != null;

/**
 * The shipped dev commands are only correct in ONE situation: the publisher developing *inside
 * the package clone* under Bun (cwd === package, TypeScript runs directly, no build). Everywhere
 * else — crucially when the package is consumed as a dependency — we bake the compiled `dist/`
 * command instead. This detects that one dev-in-clone case.
 */
export const isPackageDevCwd = (): boolean => isBun && resolve(process.cwd()) === PKG_ROOT;

/** The Claude Code skills root of a project folder. */
export const projectSkillsRoot = (projectDir: string): string => join(projectDir, '.claude', 'skills');

/** Source path of a shipped skill's SKILL.md, by skill name. */
export const skillSource = (name: string): string =>
  join(PKG_ROOT, '.claude', 'skills', name, 'SKILL.md');

const runtimeName = (): string => (isBun ? 'bun' : 'node');

/**
 * One shipped skill's SKILL.md. `dist=false` returns it verbatim (the dev form). `dist=true`
 * rewrites engine commands to `<node|bun> "<rel>/dist/X.js"` and the bare `data/…` paths the agent
 * reads to the project-relative DATA_DIR. Nothing machine-absolute is baked.
 */
export function skillBody(name: string, dist = false): string {
  const raw = readFileSync(skillSource(name), 'utf8');
  if (!dist) return raw;
  const cmd = (base: string): string => `${runtimeName()} "${toProjectRel(join(DIST_DIR, base + '.js'))}"`;
  return raw
    .replace(/bun run src\/yt-transcript\.ts/g, cmd('yt-transcript'))
    .replace(/bun run src\/yt-search\.ts/g, cmd('yt-search'))
    .replace(/data\//g, toProjectRel(DATA_DIR) + '/');
}

/**
 * The mod's `hooks/engine.ts`: how the mod runs the engine. `dist=false` is the shipped dev form;
 * `dist=true` points at the compiled scripts, relative to the project root (the session's cwd).
 */
export function engineModule(dist = false): string {
  const shipped = readFileSync(join(PKG_ROOT, 'plugin', 'hooks', 'engine.ts'), 'utf8');
  if (!dist) return shipped;
  const rel = toProjectRel(DIST_DIR);
  return [
    '// How the mod runs the engine, relative to the project root (the session\'s working directory).',
    '// Written by `yt-briefing install-skill`; re-run it after moving the project or switching runtime.',
    `export const engine = (name: string): string[] => ['${runtimeName()}', \`${rel}/\${name}.js\`]`,
    '',
  ].join('\n');
}

/** Write the mod into `<skillsRoot>/yt-briefing/`. Returns the folder written. */
export function installPlugin(skillsRoot: string, dist = false): string {
  const dir = join(skillsRoot, PLUGIN);
  for (const file of PLUGIN_FILES) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(PKG_ROOT, 'plugin', file), 'utf8'), 'utf8');
  }
  writeFileSync(join(dir, 'hooks', 'engine.ts'), engineModule(dist), 'utf8');
  return dir;
}

/** Write every shipped skill into `skillsRoot/<name>/SKILL.md`. Returns the paths written. */
export function installSkills(skillsRoot: string, dist = false): string[] {
  return SKILLS.map((name) => {
    const dir = join(skillsRoot, name);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, 'SKILL.md');
    writeFileSync(target, skillBody(name, dist), 'utf8');
    return target;
  });
}

/** Substring identifying the 0.x summary gate inside a settings.json hook command. */
const GATE_ID = 'yt-summary-gate';

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string }[] };
export type Settings = { hooks?: { PreToolUse?: HookEntry[]; [event: string]: HookEntry[] | undefined } };

/** Drop the 0.x summary gate from a settings object; every other setting and hook stays as found. */
export function withoutGateHook(settings: Settings): Settings {
  const pre = settings.hooks?.PreToolUse;
  if (!pre) return settings;
  const kept = pre.filter((e) => !e.hooks?.some((h) => h.command?.includes(GATE_ID)));
  if (kept.length === pre.length) return settings;
  if (kept.length) settings.hooks!.PreToolUse = kept;
  else delete settings.hooks!.PreToolUse;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return settings;
}

/**
 * Remove what 1.0 replaced from a project: the chat-driven `/yt` skill (only if it is ours — it
 * runs yt-sweep) and the summary gate in `.claude/settings.json` (left alone if the file isn't
 * valid JSON: a hand-edited config is not ours to rewrite). Returns what was removed.
 */
export function removeLegacy(projectDir: string): string[] {
  const removed: string[] = [];
  const oldSkill = join(projectSkillsRoot(projectDir), 'yt');
  const oldSkillMd = join(oldSkill, 'SKILL.md');
  if (existsSync(oldSkillMd) && readFileSync(oldSkillMd, 'utf8').includes('yt-sweep')) {
    rmSync(oldSkillMd);
    if (readdirSync(oldSkill).length === 0) rmSync(oldSkill, { recursive: true });
    removed.push(oldSkillMd);
  }
  const settingsPath = join(projectDir, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const before = readFileSync(settingsPath, 'utf8');
      const after = JSON.stringify(withoutGateHook(JSON.parse(before) as Settings), null, 2) + '\n';
      if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(JSON.parse(after))) {
        writeFileSync(settingsPath, after, 'utf8');
        removed.push(`${settingsPath} (summary gate hook)`);
      }
    } catch { /* not valid JSON → leave it */ }
  }
  return removed;
}

/** Install everything into a project: legacy cleanup, the mod, the skills. Returns paths written/removed. */
export function installAll(projectDir: string, dist: boolean): { written: string[]; removed: string[] } {
  const removed = removeLegacy(projectDir);
  const root = projectSkillsRoot(projectDir);
  const written = [installPlugin(root, dist), ...installSkills(root, dist)];
  return { written, removed };
}
