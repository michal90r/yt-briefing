#!/usr/bin/env bun
/**
 * Usage:
 *   bun src/yt-rating.ts --rating 0|1 [--comment "..."]
 *
 * Channel / id / title / type default to <DATA_DIR>/.cache/pending.json (written by
 * yt-sweep.ts) so the agent only passes --rating (+ optional --comment) — no fragile
 * shell quoting of emoji/quote-laden titles. Explicit flags override:
 *   --channel @X --id Y --title "..." --type longform|short|live [--baseline] [--cap 10] [--no-state]
 *
 * Rating model (no positive rating — keeping the channel is the implicit positive):
 *   1 = neutral      → bump the state pointer only (video seen, no signal), profile untouched.
 *   0 = worthless    → append a negative few-shot to `## Skip titles` (FIFO cap, default 10).
 *   comment          → append a durable rule to `## Notes`, seen by both filters.
 *
 * Direct durable commit — no rolling buffer, no consolidation. Idempotent: identical
 * bullets are de-duplicated; a state.md re-bump is a no-op.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import dotenv from 'dotenv';
import { parseChannels, appendSkipTitle, appendNote, bumpStatePointer, type ChannelEntry } from './lib/yt-lib.ts';
import { CHANNELS_MD, STATE_MD, PENDING_FILE, ENV_PATH, profilePath } from './lib/paths.ts';

dotenv.config({ path: ENV_PATH });

interface Args {
  channel: string;
  id: string;
  title: string;
  type: 'longform' | 'short' | 'live';
  rating: number;
  comment: string;
  baseline: boolean;
  cap: number;
  noState: boolean;
}

function getArg(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] !== undefined ? args[idx + 1]! : null;
}

/**
 * Video metadata defaults to .cache/pending.json (written by yt-sweep.ts) so the agent
 * only needs to pass --rating (+ optional --comment). Explicit flags still override.
 */
function loadPending(): Partial<{ channel: string; videoId: string; title: string; type: string; is_baseline: boolean }> {
  if (!existsSync(PENDING_FILE)) return {};
  try { return JSON.parse(readFileSync(PENDING_FILE, 'utf8')); } catch { return {}; }
}

function parseArgs(argv: string[]): Args {
  const pending = loadPending();
  const channel = getArg(argv, '--channel') ?? pending.channel ?? null;
  const id = getArg(argv, '--id') ?? pending.videoId ?? null;
  const title = getArg(argv, '--title') ?? pending.title ?? null;
  const type = getArg(argv, '--type') ?? pending.type ?? null;
  const ratingRaw = getArg(argv, '--rating');
  const comment = getArg(argv, '--comment') ?? '';
  const baseline = argv.includes('--baseline') || pending.is_baseline === true;
  const noState = argv.includes('--no-state');
  const capRaw = getArg(argv, '--cap');

  if (!channel || !id || !title || !type || !ratingRaw) {
    console.error('Usage: bun yt-rating.ts --rating 0|1 [--comment "..."]  (channel/id/title/type default to .cache/pending.json; override with --channel @X --id Y --title "..." --type longform|short|live) [--baseline] [--cap 10] [--no-state]');
    process.exit(1);
  }
  if (!['longform', 'short', 'live'].includes(type)) {
    console.error(`Invalid --type: ${type}`);
    process.exit(1);
  }
  const rating = parseInt(ratingRaw, 10);
  // Permissive 0..5 so older profiles / scripts keep working; the live UI emits only 0|1.
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    console.error(`Invalid --rating: ${ratingRaw} (must be 0 or 1)`);
    process.exit(1);
  }
  const cap = capRaw ? parseInt(capRaw, 10) : 10;
  return { channel, id, title, type: type as Args['type'], rating, comment, baseline, cap, noState };
}

const args = parseArgs(process.argv.slice(2));

const channels: ChannelEntry[] = parseChannels(readFileSync(CHANNELS_MD, 'utf8'));
const ch = channels.find(c => c.handle === args.channel);
if (!ch) {
  console.error(`Channel ${args.channel} not found in channels.md`);
  process.exit(1);
}

const profile = profilePath(ch.slug);
if (!existsSync(profile)) {
  console.error(`Profile not found: ${profile}`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);

// 1. Durable profile writes (no buffer, no consolidation):
//    rating=0 → negative few-shot; comment → Notes rule. rating=1 w/o comment → nothing.
const profileBefore = readFileSync(profile, 'utf8');
let profileAfter = profileBefore;
if (args.rating === 0) {
  profileAfter = appendSkipTitle(profileAfter, { title: args.title, type: args.type }, args.cap);
}
if (args.comment && args.comment.trim()) {
  profileAfter = appendNote(profileAfter, args.comment.trim());
}
if (profileAfter !== profileBefore) {
  writeFileSync(profile, profileAfter, 'utf8');
}

// 2. Bump state.md pointer (unless --no-state)
let stateBumped = false;
if (!args.noState) {
  const stateBefore = readFileSync(STATE_MD, 'utf8');
  const stateAfter = bumpStatePointer(stateBefore, args.channel, args.type, args.id, date);
  if (stateAfter !== stateBefore) {
    writeFileSync(STATE_MD, stateAfter, 'utf8');
    stateBumped = true;
  }
}

console.log(JSON.stringify({
  ok: true,
  profile: `channels/${ch.slug}.md`,
  state_bumped: stateBumped,
}));
