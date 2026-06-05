#!/usr/bin/env node
/**
 * install-skill — copy the `/yt` skill into a coding agent's skills directory so the
 * agent detects it. For any target that isn't this package under Bun, the command is baked to
 * `"<this runtime>" "<abs>/dist/X.js"` (the compiled build), so it works no matter the agent's
 * working directory or runtime (the engine resolves data/.env from its own location).
 *
 *   yt-briefing install-skill        # interactive: pick agent + scope
 *
 * `bun run init` already installs this skill into the project as its final step; this
 * standalone command is for re-installing, a different project, or a second agent. There is
 * deliberately no home-global install — the skill lives with the project that uses it.
 *
 * Both Claude Code and Cursor load `SKILL.md` skills and invoke them as `/<name>`.
 * Cursor also reads `.claude/skills/` for compatibility, so the copy this package already
 * ships often works in both — this command just (re)places it where you want.
 */

import { AGENTS, installSkill, projectSkillDir, customSkillDirDefault, isPackageDevCwd } from './lib/skill-install.ts';
import { question } from './lib/prompt.ts';

const ask = (q: string, def = ''): string => question(def ? `${q} [${def}]:` : `${q}:`).trim() || def;

function done(target: string): void {
  console.log(`\n  ✓ Installed → ${target}`);
  console.log('  Start a fresh agent session, then run  /yt\n');
}

// 1) which agent → which skills subdir
console.log('\n  Install the /yt skill — which agent?\n');
console.log('    1) Claude Code');
console.log('    2) Cursor   (also reads Claude\'s .claude/skills)');
console.log('    3) Custom folder (any other agent)\n');

const agentKey = ask('  Agent', '1');
const agent = AGENTS[agentKey];

// 3) Custom — write SKILL.md straight into a folder the user names (their agent's skills dir).
// Arbitrary location → bake the absolute dist command so it works whatever the agent's cwd is.
if (!agent) {
  done(installSkill(ask('  Folder to install the skill into', customSkillDirDefault()), true));
  process.exit(0);
}

// 2) Known agent → which project (default: the current folder). No home-global option by
// design — the skill is always scoped to a project that uses it.
console.log(`\n  ${agent.name} — which project?\n`);
console.log('    1) This project (current folder) — recommended');
console.log('    2) Another project folder\n');

if (ask('  Where', '1') === '2') {
  // A different project → the agent's cwd won't be the package, so bake the absolute dist command.
  done(installSkill(projectSkillDir(agentKey, ask('  Project folder', process.cwd())), true));
} else {
  // Current folder: shipped `bun run src` only when developing in the package clone under Bun;
  // otherwise (incl. consuming the package as a dependency) bake the compiled dist command.
  done(installSkill(projectSkillDir(agentKey, process.cwd()), !isPackageDevCwd()));
}
