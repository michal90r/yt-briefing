#!/usr/bin/env node
/**
 * install-skill — install yt-briefing into a Claude Code project: the `/yt` mod (the rating loop)
 * plus the `/yt-transcribe` and `/yt-search` skills, all under `<project>/.claude/skills/`.
 *
 *   yt-briefing install-skill        # interactive: which project folder
 *
 * `init` already does this as its final step; this standalone command is for re-installing
 * (e.g. after an upgrade), or for another project. There is deliberately no home-global install —
 * everything lives with the project that uses it. Upgrading from 0.x also removes the old
 * chat-driven `/yt` skill and the summary-gate hook it needed.
 */

import { installAll, isPackageDevCwd } from './lib/skill-install.ts';
import { question } from './lib/prompt.ts';

const ask = (q: string, def = ''): string => question(def ? `${q} [${def}]:` : `${q}:`).trim() || def;

console.log('\n  Install /yt + /yt-transcribe + /yt-search into a Claude Code project.\n');
console.log('    1) This project (current folder) — recommended');
console.log('    2) Another project folder\n');

const other = ask('  Where', '1') === '2';
const projectDir = other ? ask('  Project folder', process.cwd()) : process.cwd();
// The shipped dev commands only work developing inside the package clone under Bun; anything
// else (another folder, Node, the package consumed as a dependency) gets the compiled dist/ form.
const { written, removed } = installAll(projectDir, other || !isPackageDevCwd());

console.log('\n  Installed:');
for (const t of written) console.log(`      ${t}`);
if (removed.length) {
  console.log('  Removed (replaced in 1.0):');
  for (const r of removed) console.log(`      ${r}`);
}
console.log('\n  Start a fresh Claude Code session in that project (trust the folder when asked), then run  /yt\n');
