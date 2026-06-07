/**
 * skill-install — place the `/yt` SKILL.md into a coding agent's skills directory.
 *
 * Shared by the onboarding wizard (`bootstrap.ts`, final step) and the standalone
 * `install-skill.ts` command, so both write the skill identically.
 *
 * The shipped SKILL.md uses `bun run src/X.ts` — the dev shortcut: it works when the agent's
 * cwd IS the package folder AND the runtime is Bun (which runs TypeScript directly). That's
 * true for the publisher's own day-to-day use, so it stays the default.
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

export const SOURCE = join(PKG_ROOT, '.claude/skills/yt/SKILL.md');

/** Agent key → display name + the skills subdirectory it scans. */
export const AGENTS: Record<string, { name: string; sub: string }> = {
  '1': { name: 'Claude Code', sub: join('.claude', 'skills', 'yt') },
  '2': { name: 'Cursor',      sub: join('.cursor', 'skills', 'yt') },
};

/**
 * The shipped SKILL.md. `dist=false` (default) returns it verbatim — the `bun run src/X.ts`
 * dev form, correct only when cwd is the package AND the runtime is Bun. `dist=true` rewrites
 * for the consumed case: engine commands become `"<process.execPath>" "<abs>/dist/X.js"` (this
 * machine's runtime, Node or Bun, against the compiled build, so they run from any cwd), and the
 * bare `data/…` paths the agent reads (e.g. `data/config.json`) become the absolute `DATA_DIR`.
 * In dev the agent's cwd IS the package so `data/` resolves; when consumed, DATA_DIR moves to
 * `<project>/.yt-briefing/data`, so the dev-relative paths would miss — hence the rewrite.
 */
export function skillBody(dist = false): string {
  const raw = readFileSync(SOURCE, 'utf8');
  if (!dist) return raw;
  const exe = process.execPath;
  const cmd = (base: string): string => `"${exe}" "${join(DIST_DIR, base + '.js')}"`;
  return raw
    .replace(/bun run src\/yt-sweep\.ts/g, cmd('yt-sweep'))
    .replace(/bun run src\/yt-rating\.ts/g, cmd('yt-rating'))
    .replace(/data\//g, DATA_DIR + '/');
}

/** Write the skill into `dir` (created if needed). Returns the SKILL.md path written. */
export function installSkill(dir: string, dist = false): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, 'SKILL.md');
  writeFileSync(target, skillBody(dist), 'utf8');
  return target;
}

/** The agent's skills directory inside a project folder (the project you open in the agent). */
export const projectSkillDir = (agentKey: string, projectDir: string): string =>
  join(projectDir, AGENTS[agentKey].sub);

/** Suggested target for a "custom" (any other agent) install — the open `.agents` convention,
 *  rooted at the user's current project (not the package, which may be in node_modules). */
export const customSkillDirDefault = (): string =>
  join(process.cwd(), '.agents', 'skills', 'yt');
