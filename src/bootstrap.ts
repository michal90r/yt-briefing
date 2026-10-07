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
 *   3. Installs /yt (the rating loop) + /yt-transcribe + /yt-search into this Claude Code project
 *
 * It does NOT touch keys: the one key (YouTube Data API) lives in your project root .env (see README →
 * Setup); the engine reads it at run time. Filters and summaries run on your Claude Code login. Re-running is safe: it warns before overwriting existing data and bails.
 * Everything it writes is plain Markdown / JSON you can also edit by hand afterwards.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_DIR, BASE_DIR, PKG_ROOT, CHANNELS_DIR, CHANNELS_MD, STATE_MD, CONFIG_JSON, profilePath, ROOT_ENV_PATH,
} from './lib/paths.ts';
import { loadEnv, missingEnv, REQUIRED_YOUTUBE } from './lib/env.ts';
import { installAll, isPackageDevCwd } from './lib/skill-install.ts';
import { claudeMissing } from './lib/llm.ts';
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

  // Keys are NOT asked here — the YouTube key lives in your project root .env (see README →
  // Setup). The engine reads it at run time and fails fast naming it if missing.

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

  // 3. Write everything --------------------------------------------------------
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

  // Install into THIS project — process.cwd(), wherever you ran the command (the package clone in
  // dev, or your own project when the package is a dependency). The shipped dev commands only for
  // the dev-in-clone case; otherwise the compiled `dist/` commands (so a consumed package works).
  try {
    const { written, removed } = installAll(process.cwd(), /* dist */ !isPackageDevCwd());
    for (const t of written) console.log(`    claude → ${t}`);
    for (const r of removed) console.log(`    removed (replaced in 1.0) → ${r}`);
  } catch (e) {
    console.log(`  ! Couldn't install into .claude/skills (${(e as Error).message}) — run  yt-briefing install-skill  later.`);
  }

  // Preflight what the engine needs at run time, so the gap surfaces here instead of at the
  // first /yt: the YouTube key in the project root .env, and a logged-in `claude` CLI.
  loadEnv();
  const missingKeys = missingEnv(REQUIRED_YOUTUBE);
  if (missingKeys.length) {
    console.log('\n  ⚠ Key still needed before /yt will run — add it to your project root .env:');
    for (const k of missingKeys) console.log(`      ${k}`);
    console.log(`    Path: ${ROOT_ENV_PATH}   ·   see README → Setup`);
  }
  const noClaude = claudeMissing();
  if (noClaude) console.log(`\n  ⚠ ${noClaude}`);

  console.log('\n  Next:');
  console.log('    1. Open this folder in Claude Code (trust it when asked).');
  console.log('    2. Type  /yt  — the briefing runs in the chat.  (/yt-transcribe <url> for one video)\n');
}

try { main(); } catch (err) { console.error(err); process.exit(1); }
