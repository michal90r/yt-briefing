#!/usr/bin/env node
/**
 * Usage:
 *   bun src/yt-rating.ts --rating 0|1 [--comment "..."]
 *   bun src/yt-rating.ts --raw-comment "..." [--rating 0|1]
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
 *   raw comment      → the user's words as typed: distilled into a rule (and, unless --rating is
 *                      given, the rating it implies) through `claude -p`, then stored as above.
 *
 * After a recorded rating, `after_rate` from config.json (if set) runs detached from the project
 * root — e.g. a script that commits DATA_DIR. The engine never runs VCS itself.
 *
 * Direct durable commit — no rolling buffer, no consolidation. Idempotent: identical
 * bullets are de-duplicated; a state.md re-bump is a no-op.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'node:child_process';
import { loadEnv } from './lib/env.ts';
import { loadConfig } from './lib/config.ts';
import { distillComment } from './lib/distill.ts';
import { parseChannels, appendSkipTitle, appendNote, bumpStatePointer, type ChannelEntry } from './lib/yt-lib.ts';
import { CHANNELS_MD, STATE_MD, PENDING_FILE, QUEUE_FILE, profilePath } from './lib/paths.ts';

loadEnv();

interface Args {
  channel: string;
  id: string;
  title: string;
  type: 'longform' | 'short' | 'live';
  rating: number | null;
  comment: string;
  rawComment: string;
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
  const rawComment = (getArg(argv, '--raw-comment') ?? '').trim();
  const baseline = argv.includes('--baseline') || pending.is_baseline === true;
  const noState = argv.includes('--no-state');
  const capRaw = getArg(argv, '--cap');

  if (!channel || !id || !title || !type || (!ratingRaw && !rawComment)) {
    console.error('Usage: yt-briefing rate --rating 0|1 [--comment "..."] | --raw-comment "..." [--rating 0|1]  (channel/id/title/type default to .cache/pending.json; override with --channel @X --id Y --title "..." --type longform|short|live) [--baseline] [--cap 10] [--no-state]');
    process.exit(1);
  }
  if (!['longform', 'short', 'live'].includes(type)) {
    console.error(`Invalid --type: ${type}`);
    process.exit(1);
  }
  const rating = ratingRaw === null ? null : parseInt(ratingRaw, 10);
  // Permissive 0..5 so older profiles / scripts keep working; the live UI emits only 0|1.
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
    console.error(`Invalid --rating: ${ratingRaw} (must be 0 or 1)`);
    process.exit(1);
  }
  const cap = capRaw ? parseInt(capRaw, 10) : 10;
  return { channel, id, title, type: type as Args['type'], rating, comment, rawComment, baseline, cap, noState };
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

// 0. A raw comment becomes a rule (+ the implied rating unless one was given explicitly).
let rule = args.comment.trim();
let rating = args.rating;
if (args.rawComment) {
  try {
    const d = await distillComment(args.rawComment, { channel: args.channel, title: args.title, type: args.type });
    rule = d.rule;
    rating ??= d.rating;
  } catch (e) {
    console.error(`Comment not recorded: ${(e as Error).message}`);
    process.exit(1);
  }
}
if (rating === null) rating = 1;

// 1. Durable profile writes (no buffer, no consolidation):
//    rating=0 → negative few-shot; comment → Notes rule. rating=1 w/o comment → nothing.
const profileBefore = readFileSync(profile, 'utf8');
let profileAfter = profileBefore;
if (rating === 0) {
  profileAfter = appendSkipTitle(profileAfter, { title: args.title, type: args.type }, args.cap);
}
if (rule) {
  profileAfter = appendNote(profileAfter, rule);
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

// 3. Mark the rated video resolved in the run queue (`seen`) — independent of the state
//    pointer, so a cursor-regression race in yt-sweep (a detached `--fill` re-bumping a
//    stale pointer) can't re-emit an already-rated video. Best-effort: the queue is a
//    same-day throwaway and no sweep process writes it while the user rates.
if (!args.noState && existsSync(QUEUE_FILE)) {
  try {
    const q = JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
    if (q?.built_at === date && Array.isArray(q.seen) && !q.seen.includes(args.id)) {
      q.seen.push(args.id);
      writeFileSync(QUEUE_FILE, JSON.stringify(q), 'utf8');
    }
  } catch { /* corrupt / foreign queue → ignore; the next sweep rebuilds it */ }
}

// 4. The user's after-rate command (e.g. commit DATA_DIR to git). Detached: the rating is already
//    durable on disk, so a slow or failing command must not hold or fail the rating.
const afterRate = loadConfig().after_rate;
if (afterRate) {
  spawn(afterRate, { shell: true, detached: true, stdio: 'ignore' }).unref();
}

console.log(JSON.stringify({
  ok: true,
  profile: `channels/${ch.slug}.md`,
  rating,
  ...(rule ? { rule } : {}),
  state_bumped: stateBumped,
}));
