#!/usr/bin/env node
/**
 * bootstrap.ts — interactive onboarding wizard. Run once after install:
 *
 *   bun run init        (or: yt-briefing init)
 *
 * Asks for, and writes:
 *   1. Output language for summaries + ratings   → DATA_DIR/config.json
 *   2. LLM provider / model / key, YouTube key, optional proxy → .env
 *   3. The channels you follow — just a flat list of handles
 *      → DATA_DIR/channels.md, DATA_DIR/state.md, DATA_DIR/channels/<slug>.md
 *
 * Re-running is safe: it warns before overwriting existing data and lets you bail.
 * Everything it writes is plain Markdown / JSON you can also edit by hand afterwards.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_DIR, BASE_DIR, PKG_ROOT, CHANNELS_DIR, CHANNELS_MD, STATE_MD, CONFIG_JSON, ENV_PATH, profilePath,
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

  // 1. Language ----------------------------------------------------------------
  console.log('  1) Language');
  const outputLang = ask('  Output language for summaries and ratings', 'English');

  // 2. LLM provider (.env) -----------------------------------------------------
  // Pick a provider → we prefill its endpoint + a sensible model and ask ONLY for the
  // key (with the exact link to get it). The recommended free path is the default, so
  // pressing Enter lands on it — no long URL to paste, nothing to guess.
  console.log('\n  2) Which AI writes the filtering + summaries? Pick a provider:\n');
  console.log('     1) Gemini      — FREE key, best way to start   ·  https://aistudio.google.com/apikey');
  console.log('     2) OpenRouter  — one key for Gemini + GPT + …   ·  https://openrouter.ai/keys');
  console.log('     3) OpenAI      — GPT models                     ·  https://platform.openai.com/api-keys');
  console.log('     4) Other / local (Ollama or any custom endpoint)\n');
  console.log('     Type 1, 2, 3 or 4 and press Enter.  (Just press Enter for 1 — Gemini, recommended.)');

  const PROVIDERS: Record<string, { name: string; base: string; model: string; keyUrl: string }> = {
    '1': { name: 'Gemini',     base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',        keyUrl: 'https://aistudio.google.com/apikey' },
    '2': { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1',                            model: 'google/gemini-2.5-flash', keyUrl: 'https://openrouter.ai/keys' },
    '3': { name: 'OpenAI',     base: 'https://api.openai.com/v1',                               model: 'gpt-4o-mini',             keyUrl: 'https://platform.openai.com/api-keys' },
  };

  let llmBaseUrl: string, llmModel: string, llmKey: string;
  const picked = PROVIDERS[ask('  Your choice', '1')];
  if (picked) {
    console.log(`\n     → ${picked.name}. Get your key here: ${picked.keyUrl}`);
    llmKey = ask('  Paste your API key');
    llmBaseUrl = picked.base;
    llmModel = ask('  Model (Enter to accept)', picked.model);
  } else {
    console.log('\n     → Custom / local endpoint (e.g. Ollama at http://localhost:11434/v1)');
    llmBaseUrl = ask('  YT_BRIEFING_LLM_BASE_URL', 'http://localhost:11434/v1');
    llmModel = ask('  YT_BRIEFING_LLM_MODEL', 'llama3.1');
    llmKey = ask('  YT_BRIEFING_LLM_API_KEY (blank for local)', '');
  }

  console.log('\n  3) YouTube Data API (needed to list channel uploads)');
  console.log('     Get a key: https://console.cloud.google.com → YouTube Data API v3');
  const ytKey = ask('  YT_BRIEFING_YOUTUBE_API_KEY');

  console.log('\n  4) Proxy (optional — only needed on datacenter/VPS IPs; see docs/warp-proxy.md)');
  const ytProxy = ask('  YT_BRIEFING_PROXY (blank = direct)', '');

  // 5. Channels ----------------------------------------------------------------
  // Just collect a flat list. No categories, no per-channel rules to define up front —
  // each channel's profile LEARNS what to skip as you rate it (## Skip titles / ## Notes).
  console.log('\n  5) Channels you follow');
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

  // 6. Coding agent ------------------------------------------------------------
  // Place the skill INTO THIS PROJECT (the package folder you open in the agent) — never a
  // home-global dir (that's the npm -g antipattern: machine-wide, invisible, easy to forget).
  // Claude Code reads .claude/skills/ (already shipped here); Cursor reads .cursor/skills/.
  // 1/2 = known agents; 3 = any other agent (a project folder you name).
  console.log('\n  6) Which agent will you run /yt in?');
  console.log('       1) Claude Code      2) Cursor      3) Custom folder (any other agent)\n');
  const agentKey = ask('  Your agent', '1');
  // For a custom target, ask the folder now (keeps all prompts in the interactive block).
  const customDir = AGENTS[agentKey] ? '' : ask('  Skills folder to install into', customSkillsRootDefault());

  // 7. Write everything --------------------------------------------------------
  mkdirSync(CHANNELS_DIR, { recursive: true });

  // .env
  const envBody = [
    `YT_BRIEFING_LLM_BASE_URL=${llmBaseUrl}`,
    `YT_BRIEFING_LLM_API_KEY=${llmKey}`,
    `YT_BRIEFING_LLM_MODEL=${llmModel}`,
    `YT_BRIEFING_YOUTUBE_API_KEY=${ytKey}`,
    `YT_BRIEFING_PROXY=${ytProxy}`,
    '',
  ].join('\n');
  writeFileSync(ENV_PATH, envBody, 'utf8');

  // Secret-safety for the consume layout: drop a .gitignore inside .yt-briefing/ so .env never
  // gets committed regardless of the host project's own ignore rules. data/ stays versionable
  // (for sync). In a dev clone (BASE_DIR === PKG_ROOT) the repo's own .gitignore already covers it.
  if (BASE_DIR !== PKG_ROOT) {
    writeFileSync(join(BASE_DIR, '.gitignore'), '.env\ndata/.cache/\n', 'utf8');
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
  console.log(`    ${ENV_PATH}`);
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
