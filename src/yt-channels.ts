#!/usr/bin/env node
/**
 * Add, remove, or list the channels you follow — keeping channels.md, state.md, and the
 * per-channel profile in sync. Driven by the CLI: `yt-briefing add|remove|list ...`.
 *
 *   yt-briefing add @foo https://youtube.com/@bar   # add one or more (handle or URL)
 *   yt-briefing remove @foo                          # remove (also deletes its profile)
 *   yt-briefing list                                 # show the current list
 *
 * Adding a channel starts it at "baseline" (next sweep surfaces the latest upload per type);
 * removing one drops its row and learned profile. Existing channels' cursors are untouched.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { CHANNELS_MD, STATE_MD, profilePath } from './lib/paths.ts';
import { parseChannels, parseState } from './lib/yt-lib.ts';
import {
  normalizeHandle, slugify, serializeChannels, serializeState, profileBody, baselineStateRow,
} from './lib/channels.ts';

const [action, ...args] = process.argv.slice(2);

if (!existsSync(CHANNELS_MD) || !existsSync(STATE_MD)) {
  console.error('No channel list yet — run onboarding first: yt-briefing init');
  process.exit(1);
}

let entries = parseChannels(readFileSync(CHANNELS_MD, 'utf8'));

if (action === 'list') {
  for (const e of entries) console.log(`  ${e.handle}`);
  console.log(`\n  ${entries.length} channel(s).`);
  process.exit(0);
}

if ((action !== 'add' && action !== 'remove') || args.length === 0) {
  console.error('Usage: yt-briefing add|remove <@handle | url> [...]   ·   yt-briefing list');
  process.exit(1);
}

let rows = parseState(readFileSync(STATE_MD, 'utf8'));
let changed = 0;

for (const raw of args) {
  const handle = normalizeHandle(raw);
  if (!handle) { console.log(`  ! couldn't read a handle from "${raw}" — use @name or the channel URL`); continue; }
  const slug = slugify(handle);
  const exists = entries.some(e => e.slug === slug);

  if (action === 'add') {
    if (exists) { console.log(`  • ${handle} already on the list — skipping`); continue; }
    entries.push({ handle, slug });
    rows.push(baselineStateRow(handle));
    writeFileSync(profilePath(slug), profileBody(handle, slug), 'utf8');
    console.log(`  + ${handle}`);
    changed++;
  } else {
    if (!exists) { console.log(`  • ${handle} not on the list — skipping`); continue; }
    const entry = entries.find(e => e.slug === slug)!;
    entries = entries.filter(e => e.slug !== slug);
    rows = rows.filter(r => r.handle !== entry.handle);
    try { rmSync(profilePath(slug)); } catch { /* profile already gone */ }
    console.log(`  − ${handle}  (profile deleted)`);
    changed++;
  }
}

if (changed) {
  writeFileSync(CHANNELS_MD, serializeChannels(entries), 'utf8');
  writeFileSync(STATE_MD, serializeState(rows), 'utf8');
}
console.log(`\n  ${entries.length} channel(s) now. The next sweep picks up the change.`);
