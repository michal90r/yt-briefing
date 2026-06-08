#!/usr/bin/env node
/**
 * bootstrap.ts — interactive onboarding wizard. Run once after install:
 *
 *   bun run init        (or: yt-briefing init)
 *
 * Asks for, and writes:
 *   1. Output language for summaries + ratings   → DATA_DIR/config.json
 *   2. The channels you follow — just a flat list of handles
 *      → DATA_DIR/channels.md, DATA_DIR/state.md, DATA_DIR/channels/<slug>.md
 *   3. Which agent runs /yt — installs the skill into its skills dir
 *
 * It does NOT touch keys: those live in your project root .env (see README → Setup); the engine
 * reads them at run time. Re-running is safe: it warns before overwriting existing data and bails.
 * Everything it writes is plain Markdown / JSON you can also edit by hand afterwards.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_DIR, BASE_DIR, PKG_ROOT, CHANNELS_DIR, CHANNELS_MD, STATE_MD, CONFIG_JSON, profilePath,
} from './lib/paths.ts';
import { AGENTS, installSkills, projectSkillsRoot, customSkillsRootDefault, isPackageDevCwd } from './lib/skill-install.ts';
import { question } from './lib/prompt.ts';
import { normalizeHandle, slugify, serializeChannels, serializeState, profileBody, baselineStateRow } from './lib/channels.ts';

const ask = (q: string, def = ''): string => {
  const a = question(def ? `${q} [${def}]:` : `${q}:`).trim();
  return a || def;
};
const askYN = (q: string, def = true): boolean => {
  const a = ask(`${q} (${def ? 'Y/n' : 'y/N'})`).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
};
interface ChannelInput { handle: string; slug: string; }

function main(): void {
  console.log('\n  yt-briefing — onboarding\n  ' + '─'.repeat(40) + '\n');

  if (existsSync(CHANNELS_MD)) {
    console.log(`  Existing data found at ${DATA_DIR}`);
    if (!askYN('  Overwrite it?', false)) {
      console.log('  Aborted — nothing changed.\n');
      return;
    }
    console.log('');
  }

  // Keys are NOT asked here — they live in your project root .env (LLM + YouTube; see README
  // → Setup). The engine reads them at run time and fails fast naming any that are missing.

  // 1. Language ----------------------------------------------------------------
  console.log('  1) Language');
  const outputLang = ask('  Output language for summaries and ratings', 'English');

  // 2. Channels ----------------------------------------------------------------
  // Just collect a flat list. No categories, no per-channel rules to define up front —
  // each channel's profile LEARNS what to skip as you rate it (## Skip titles / ## Notes).
  console.log('\n  2) Channels you follow');
  console.log('     Add one per line — paste whichever form you have, all work as-is:');
  console.log('     eg. @betterstack, betterstack or https://www.youtube.com/@betterstack');
  console.log('     (Paste the full URL directly — it reads the @handle for you) Empty line to finish.');
  console.log('     Each channel learns what to skip as you rate it.\n');

  const channels: ChannelInput[] = [];

  while (true) {
    const raw = ask('  Channel (blank to finish)');
    if (!raw) break;
    const handle = normalizeHandle(raw);
    if (!handle) {
      console.log(`  ! couldn't read a handle from "${raw}" — use @name or the channel URL.\n`);
      continue;
    }
    const slug = slugify(handle);
    if (channels.some(c => c.slug === slug)) {
      console.log(`  ! ${handle} already added — skipping.\n`);
      continue;
    }
    channels.push({ handle, slug });
    console.log(`  ✓ ${handle}\n`);
  }

  if (channels.length === 0) {
    console.log('\n  No channels added — you can add them later by editing data/channels.md.\n');
  }

  // 3. Coding agent ------------------------------------------------------------
  // Place the skill INTO THIS PROJECT (the package folder you open in the agent) — never a
  // home-global dir (that's the npm -g antipattern: machine-wide, invisible, easy to forget).
  // SKILL.md is the cross-agent standard, so the shipped skill runs in any compatible agent —
  // we just install it into that agent's skills dir (.claude/skills, .cursor/skills, .codex/skills).
  // 1/2/3 = known agents; 4 = any other compatible agent (a project folder you name).
  console.log('\n  3) Which agent will you run /yt in?  (it ships a standard Agent Skill — any compatible agent works)');
  console.log('       1) Claude Code   2) Cursor   3) Codex   4) Custom folder (any other agent)\n');
  const agentKey = ask('  Your agent', '1');
  // For a custom target, ask the folder now (keeps all prompts in the interactive block).
  const customDir = AGENTS[agentKey] ? '' : ask('  Skills folder to install into', customSkillsRootDefault());

  // 4. Write everything --------------------------------------------------------
  mkdirSync(CHANNELS_DIR, { recursive: true });

  // Keep the throwaway cache out of git for the consume layout. data/ stays versionable (for sync).
  if (BASE_DIR !== PKG_ROOT) {
    writeFileSync(join(BASE_DIR, '.gitignore'), 'data/.cache/\n', 'utf8');
  }

  // config.json
  writeFileSync(CONFIG_JSON, JSON.stringify({ output_lang: outputLang }, null, 2) + '\n', 'utf8');

  // channels.md / state.md / per-channel profiles — via the shared serializers, so the
  // on-disk format is identical to what the add/remove command writes (single source).
  writeFileSync(CHANNELS_MD, serializeChannels(channels), 'utf8');
  writeFileSync(STATE_MD, serializeState(channels.map(c => baselineStateRow(c.handle))), 'utf8');
  for (const c of channels) writeFileSync(profilePath(c.slug), profileBody(c.handle, c.slug), 'utf8');

  console.log('  ' + '─'.repeat(40));
  console.log(`  Done. Wrote:`);
  console.log(`    ${CONFIG_JSON}`);
  console.log(`    ${CHANNELS_MD}`);
  console.log(`    ${STATE_MD}`);
  console.log(`    ${channels.length} profile(s) in ${CHANNELS_DIR}/`);

  // Install the /yt + /yt-transcribe skills for the chosen agent (step 6), into THIS project —
  // process.cwd(), i.e. wherever you ran the command (the package clone in dev, or your own
  // project when the package is a dependency). The command baked in is the shipped `bun run src`
  // only for the dev-in-clone case; otherwise the compiled `dist/` command (so a consumed package works).
  const agent = AGENTS[agentKey];
  try {
    const targets = agent
      ? installSkills(projectSkillsRoot(agentKey, process.cwd()), /* dist */ !isPackageDevCwd())
      : installSkills(customDir, /* dist */ true);
    for (const t of targets) console.log(`    skill → ${t}`);
  } catch (e) {
    console.log(`  ! Couldn't install the skills (${(e as Error).message}) — run  yt-briefing install-skill  later.`);
  }

  console.log('\n  Next:');
  console.log(`    1. Open this folder in ${agent ? agent.name : 'your agent'}.`);
  console.log('    2. Start a new chat and type  /yt  (or  /yt-transcribe <url>)');
  console.log('\n  No agent? Run it in the terminal instead — see the README.\n');
}

try { main(); } catch (err) { console.error(err); process.exit(1); }
