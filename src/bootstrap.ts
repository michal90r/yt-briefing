#!/usr/bin/env bun
/**
 * bootstrap.ts — interactive onboarding wizard. Run once after install:
 *
 *   bun run init        (or: yt-briefing init)
 *
 * Asks for, and writes:
 *   1. Output language for summaries + ratings   → DATA_DIR/config.json
 *   2. LLM provider / model / key, YouTube key, optional proxy → .env
 *   3. The channels you follow — handle, category, and what to pay attention to in each
 *      → DATA_DIR/channels.md, DATA_DIR/state.md, DATA_DIR/channels/<slug>.md
 *
 * Re-running is safe: it warns before overwriting existing data and lets you bail.
 * Everything it writes is plain Markdown / JSON you can also edit by hand afterwards.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  DATA_DIR, CHANNELS_DIR, CHANNELS_MD, STATE_MD, CONFIG_JSON, ENV_PATH, profilePath,
} from './lib/paths.ts';

// Bun's native, synchronous line reader — works for an interactive TTY and for piped
// stdin alike (unlike node:readline/promises, which stalls on a pipe under Bun).
declare function prompt(message?: string, _default?: string): string | null;

const ask = (q: string, def = ''): string => {
  const a = (prompt(def ? `${q} [${def}]:` : `${q}:`) ?? '').trim();
  return a || def;
};
const askYN = (q: string, def = true): boolean => {
  const a = ask(`${q} (${def ? 'Y/n' : 'y/N'})`).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
};

/** kebab-case slug that also breaks CamelCase: "KanalZeroPL" → "kanal-zero-pl". */
function slugify(s: string): string {
  return s
    .replace(/@/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

const today = new Date().toISOString().slice(0, 10);
// Fresh channels start "baseline": the first sweep surfaces the latest upload per type.
// updated is set this far back so that window actually contains a recent video.
const BASELINE_LOOKBACK_DAYS = 60;
const lookback = new Date(Date.now() - BASELINE_LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);

interface ChannelInput { handle: string; slug: string; categorySlug: string; attention: string; }
interface CategoryInput { slug: string; name: string; policy: string; }

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

  // 2. Secrets (.env) ----------------------------------------------------------
  console.log('\n  2) LLM provider (any OpenAI-compatible endpoint)');
  console.log('     Cheapest start: a FREE Gemini key from https://aistudio.google.com/apikey');
  console.log('     — then answer:  LLM_BASE_URL = https://generativelanguage.googleapis.com/v1beta/openai');
  console.log('                     LLM_MODEL    = gemini-2.5-flash');
  console.log('     The defaults below use OpenRouter (one key for Gemini + GPT + others).\n');
  const llmBaseUrl = ask('  LLM_BASE_URL', 'https://openrouter.ai/api/v1');
  const llmModel = ask('  LLM_MODEL (one model for both filtering and summaries)', 'google/gemini-2.5-flash');
  const llmKey = ask('  LLM_API_KEY');

  console.log('\n  3) YouTube Data API (needed to list channel uploads)');
  console.log('     Get a key: https://console.cloud.google.com → YouTube Data API v3');
  const ytKey = ask('  YOUTUBE_API_KEY');

  console.log('\n  4) Proxy (optional — only needed on datacenter/VPS IPs; see docs/warp-proxy.md)');
  const ytProxy = ask('  YT_PROXY (blank = direct)', '');

  // 5. Channels ----------------------------------------------------------------
  console.log('\n  5) Channels');
  console.log('     For each channel: its @handle, a category, and what to pay attention to.');
  console.log('     A category groups channels and carries a shared "base policy". Leave the');
  console.log('     handle blank to finish.\n');

  const categories = new Map<string, CategoryInput>();
  const channels: ChannelInput[] = [];

  while (true) {
    const handleRaw = ask('  Channel @handle (blank to finish)');
    if (!handleRaw) break;
    const handle = handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`;
    const slug = slugify(handle);
    if (channels.some(c => c.slug === slug)) {
      console.log(`  ! ${handle} already added — skipping.\n`);
      continue;
    }

    const existingNames = [...categories.values()].map(c => c.name);
    const catHint = existingNames.length ? ` (existing: ${existingNames.join(', ')})` : '';
    const categoryName = ask(`  Category for ${handle}${catHint}`, existingNames[0] || 'general');
    const categorySlug = slugify(categoryName) || 'general';
    if (!categories.has(categorySlug)) {
      const policy = ask(`  Base policy for "${categoryName}" — what matters across this category`);
      categories.set(categorySlug, { slug: categorySlug, name: categoryName, policy });
    }

    const attention = ask(`  What to pay attention to in ${handle} specifically (optional)`);
    channels.push({ handle, slug, categorySlug, attention });
    console.log(`  ✓ added ${handle}\n`);
  }

  if (channels.length === 0) {
    console.log('\n  No channels added — you can add them later by editing data/channels.md.\n');
  }

  // 6. Write everything --------------------------------------------------------
  mkdirSync(CHANNELS_DIR, { recursive: true });

  // .env
  const envBody = [
    `LLM_BASE_URL=${llmBaseUrl}`,
    `LLM_API_KEY=${llmKey}`,
    `LLM_MODEL=${llmModel}`,
    `YOUTUBE_API_KEY=${ytKey}`,
    `YT_PROXY=${ytProxy}`,
    '',
  ].join('\n');
  writeFileSync(ENV_PATH, envBody, 'utf8');

  // config.json
  writeFileSync(CONFIG_JSON, JSON.stringify({ output_lang: outputLang }, null, 2) + '\n', 'utf8');

  // group channels by category, preserving first-seen category order
  const byCat = new Map<string, ChannelInput[]>();
  for (const c of channels) {
    if (!byCat.has(c.categorySlug)) byCat.set(c.categorySlug, []);
    byCat.get(c.categorySlug)!.push(c);
  }

  // channels.md
  const chParts: string[] = [
    '---',
    'type: yt-config',
    'name: yt-channels',
    'description: Categories + base policies + channel list. Per-channel specifics live in channels/<slug>.md.',
    `updated: ${today}`,
    '---',
    '',
    '# Channels',
    '',
  ];
  for (const [catSlug, cat] of categories) {
    chParts.push(`## Category: ${catSlug}`, '', '**Base policy:**', cat.policy || '_(none yet)_', '', '**Channels:**');
    for (const c of byCat.get(catSlug) || []) {
      chParts.push(`- [${c.handle}](https://www.youtube.com/${c.handle}) → [[channels/${c.slug}]]`);
    }
    chParts.push('', '---', '');
  }
  writeFileSync(CHANNELS_MD, chParts.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');

  // state.md (baseline rows: pointers "—", updated = lookback so the first sweep finds the latest upload)
  const stParts: string[] = [
    '---',
    'type: yt-state',
    'name: yt-state',
    'description: Per-channel per-type cursor. The sweep reads and updates it.',
    `updated: ${today}`,
    '---',
    '',
    '# State',
    '',
  ];
  for (const [catSlug] of categories) {
    stParts.push(`## ${catSlug}`, '');
    stParts.push('| Channel | last_longform_id | last_short_id | last_live_id | updated | session |');
    stParts.push('|---|---|---|---|---|---|');
    for (const c of byCat.get(catSlug) || []) {
      stParts.push(`| ${c.handle} | — | — | — | ${lookback} | 0 |`);
    }
    stParts.push('');
  }
  writeFileSync(STATE_MD, stParts.join('\n'), 'utf8');

  // per-channel profiles
  for (const c of channels) {
    const pParts: string[] = [
      '---',
      'type: yt-channel-profile',
      `name: ${c.slug}-profile`,
      `channel: ${c.handle}`,
      `channel_url: https://www.youtube.com/${c.handle}`,
      `category: ${c.categorySlug}`,
      `description: ${c.attention ? c.attention.replace(/\n/g, ' ') : ''}`,
      `updated: ${today}`,
      'sessions_observed: 0',
      '---',
      '',
      `# ${c.handle} — Profile`,
      '',
    ];
    if (c.attention) pParts.push('## Channel policy', '', c.attention, '');
    writeFileSync(profilePath(c.slug), pParts.join('\n'), 'utf8');
  }

  console.log('  ' + '─'.repeat(40));
  console.log(`  Done. Wrote:`);
  console.log(`    ${ENV_PATH}`);
  console.log(`    ${CONFIG_JSON}`);
  console.log(`    ${CHANNELS_MD}`);
  console.log(`    ${STATE_MD}`);
  console.log(`    ${channels.length} profile(s) in ${CHANNELS_DIR}/`);
  console.log('\n  Next: run a sweep —  bun run sweep --reset   (or use the /yt-briefing skill).\n');
}

try { main(); } catch (err) { console.error(err); process.exit(1); }
