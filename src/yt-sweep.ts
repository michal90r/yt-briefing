#!/usr/bin/env node
/**
 * yt-sweep.ts — lazy briefing engine. ONE invocation advances to the next video that
 * needs a rating (or reports done / rate_limited). All control flow, gate logic,
 * transcript fetch, and LLM calls (title-filter classification + content-filter summary)
 * live here. The frontend (skill or CLI) only renders the summary and collects the
 * rating — zero loop logic outside this file, no subprocess LLM.
 *
 * Usage:
 *   bun src/yt-sweep.ts [--reset]
 *   bun src/yt-sweep.ts --prefetch <videoId>   (internal: detached next-video warmup)
 *   bun src/yt-sweep.ts --fill                 (internal: detached queue builder)
 *
 * Output (stdout, single JSON line):
 *   {"status":"rating_needed","summary":"<md>","pending":{channel,videoId,title,type,publishedAt,is_baseline}}
 *   {"status":"done"}
 *   {"status":"rate_limited"}
 *
 * The engine ONLY writes files under DATA_DIR — it never runs git or any VCS. If you
 * want your briefing state versioned, commit DATA_DIR yourself (or point YT_BRIEFING_DATA_DIR at
 * a synced folder). Keeping persistence out of the engine is deliberate: it stays a pure
 * data tool with zero host coupling.
 *
 * State model (no module-global cache — each call is a fresh process):
 *   - <DATA_DIR>/state.md              durable source of truth for what's been rated/skipped.
 *                                      ONLY the foreground process writes it.
 *   - <DATA_DIR>/.cache/queue.json     lazy per-session queue: `channels_todo` (not yet
 *                                      expanded) + `items` (expanded, kept videos awaiting a
 *                                      rating) + `seen`. Foreground is the SOLE writer.
 *                                      Tagged with built_at; auto-rebuilt on a new day or via --reset.
 *   - <DATA_DIR>/.cache/queue-rest.json  background-fill handoff written by the --fill child.
 *   - <DATA_DIR>/.cache/pending.json   current ratable video's metadata for yt-rating.ts.
 *   - <DATA_DIR>/.cache/prefetch.json  background-computed summary for the NEXT video.
 *
 *   All .cache/ files are throwaway (rebuilt each run; safe to delete / gitignore).
 *
 * Lazy build + background fill (fast first paint): the first call lists the channels
 * (cheap) and spawns a detached `--fill` child that expands EVERY channel in parallel
 * into queue-rest.json. Meanwhile the foreground expands just enough channels to emit
 * the FIRST ratable video. Concurrency is safe: the foreground solely owns queue.json +
 * state.md; the --fill child only writes queue-rest.json and serializes its title-skips.
 *
 * Prefetch: after emitting `rating_needed`, the engine spawns a detached
 * `--prefetch <nextVideoId>` child that fetches + summarizes the next video WHILE the
 * user rates the current one, caching it in prefetch.json.
 *
 * Crash-safety: a crash before the rating leaves state.md unbumped and the queue head
 * intact → the next call re-derives and reprocesses just that one video.
 */

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, renameSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { loadEnv, missingEnv, missingEnvMessage, REQUIRED_LLM, REQUIRED_YOUTUBE } from './lib/env.ts';
import { parseChannels, parseState, bumpStatePointer } from './lib/yt-lib.ts';
import { chat, getModel } from './lib/llm.ts';
import { outputLang } from './lib/config.ts';
import {
  PKG_ROOT, CHANNELS_MD, STATE_MD, CACHE_DIR,
  QUEUE_FILE, REST_FILE, PENDING_FILE, PREFETCH_FILE, LOG_FILE, profilePath, script,
} from './lib/paths.ts';

loadEnv();
mkdirSync(CACHE_DIR, { recursive: true });

// Re-invoke sibling scripts with the SAME runtime that launched us (bun/node/deno),
// never a hardcoded binary — the tool must run wherever the user installed it.
const RUNTIME = process.execPath;

// Max channels expanded concurrently — both the foreground first-paint waves and the
// background --fill. Cold channel expansion is network-bound (a few fetch round trips),
// so a wave overlaps the latencies instead of paying them sequentially.
const CONCURRENCY = 6;

const argv = process.argv.slice(2);
const reset = argv.includes('--reset');
const fillMode = argv.includes('--fill');
const pfIdx = argv.indexOf('--prefetch');
const prefetchTarget = pfIdx !== -1 ? argv[pfIdx + 1]! : null;
const today = new Date().toISOString().slice(0, 10);
const LANG = outputLang();

// Diagnostics sink. Default: silent (stdout stays a pure JSON line — the caller never
// has to redirect anything, so no /tmp). With YT_BRIEFING_DEBUG set, timing + child stderr append
// to <DATA_DIR>/.cache/sweep.log (gitignored) — never an OS temp dir.
const DEBUG = !!process.env.YT_BRIEFING_DEBUG;
const T0 = Date.now();
const log = (msg: string) => { if (DEBUG) appendFileSync(LOG_FILE, `⏱ ${msg} (+${Date.now() - T0}ms)\n`); };

interface QueueItem {
  channel: string;
  profile_path: string;        // absolute
  videoId: string;
  title: string;
  type: 'longform' | 'short' | 'live';
  publishedAt: string;
  is_baseline: boolean;
}
type ItemType = QueueItem['type'];
interface ChannelRef { handle: string; profile_path: string; }
interface SkipRef { channel: string; type: ItemType; videoId: string; }
/**
 * Lazy queue. `channels_todo` are channels not yet expanded; `items` are expanded, kept
 * videos awaiting a rating; `seen` are videoIds already resolved this run. The foreground
 * is the SOLE writer. `seen` is the authoritative "already handled" guard so that merging
 * the background fill (which re-lists every kept video) can't re-enqueue a resolved one
 * (the state.md pointer is monotonic per (channel,type) and can't recognize an older
 * skipped video once it has advanced).
 */
interface Queue { built_at: string; channels_todo: ChannelRef[]; items: QueueItem[]; seen: string[]; }
/** Background-fill handoff: fully expanded remaining items + their title-skips. */
interface RestFill { built_at: string; items: QueueItem[]; skips: SkipRef[]; }

// ---------- subprocess helper ----------

function run(cmd: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const [exe, ...args] = cmd;
    const p = spawn(exe!, args, { cwd: PKG_ROOT, env: { ...process.env } });
    let stdout = '';
    p.stdout.on('data', d => { stdout += d.toString(); });
    // Child stderr → the gitignored debug log only (never parent stderr / stdout), so a
    // bare invocation emits nothing but the JSON line. Silent unless YT_BRIEFING_DEBUG.
    if (DEBUG) p.stderr.on('data', d => appendFileSync(LOG_FILE, d.toString()));
    else p.stderr.resume();   // drain so the child never blocks on a full pipe
    p.on('close', code => resolve({ stdout, code: code ?? 1 }));
    p.on('error', reject);
  });
}

// ---------- state mutation (inline, crash-safe per write) ----------

function bumpState(handle: string, type: QueueItem['type'], videoId: string): void {
  const before = readFileSync(STATE_MD, 'utf8');
  const after = bumpStatePointer(before, handle, type, videoId, today);
  if (after !== before) writeFileSync(STATE_MD, after, 'utf8');
}

/**
 * Persist a skip. no_transcript does NOT bump the pointer (transcript may appear
 * later → retry on the next run); every other skip advances it.
 */
function persistSkip(item: QueueItem, status: 'content_skip' | 'no_transcript'): void {
  if (status !== 'no_transcript') bumpState(item.channel, item.type, item.videoId);
}

/**
 * Apply title-skips to state.md. Always bumps the pointer (a title-skip is final).
 * Idempotent — re-applying the same skip is a no-op. ONLY the foreground calls this.
 */
function applyTitleSkips(skips: SkipRef[]): void {
  for (const s of skips) bumpState(s.channel, s.type, s.videoId);
}

/** Append items, skipping any videoId already queued OR already resolved (seen). */
function enqueue(queue: Queue, add: QueueItem[]): void {
  const have = new Set<string>([...queue.items.map(i => i.videoId), ...queue.seen]);
  for (const it of add) if (!have.has(it.videoId)) { queue.items.push(it); have.add(it.videoId); }
}

/** Pop the head and record it as resolved so a later background merge won't re-add it. */
function dropHead(queue: Queue): void {
  const v = queue.items.shift();
  if (v) queue.seen.push(v.videoId);
}

// ---------- prefetch cache (background warmup of the next video) ----------

interface Prefetch { videoId: string; summary: string; built_at: string; }

function loadPrefetch(videoId: string): string | null {
  if (!existsSync(PREFETCH_FILE)) return null;
  try {
    const p = JSON.parse(readFileSync(PREFETCH_FILE, 'utf8')) as Prefetch;
    if (p.videoId === videoId && p.built_at === today) return p.summary;
  } catch { /* corrupt → ignore */ }
  return null;
}

/** Atomic write (temp + rename) so a concurrent reader never sees a partial file. */
function writePrefetch(p: Prefetch): void {
  const tmp = `${PREFETCH_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(p));
  renameSync(tmp, PREFETCH_FILE);
}

function clearPrefetch(): void {
  if (existsSync(PREFETCH_FILE)) rmSync(PREFETCH_FILE);
}

/**
 * Spawn a detached child that warms the prefetch cache for `next` while the user rates
 * the current video. Best-effort: failures are silent, the foreground always falls back
 * to a live fetch. The child outlives this process (detached + unref).
 */
function spawnPrefetch(next: QueueItem | undefined): void {
  if (!next) return;
  const child = spawn(RUNTIME, [script('yt-sweep'), '--prefetch', next.videoId], {
    cwd: PKG_ROOT,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// ---------- background queue fill (the rest of the channels, in parallel) ----------

function loadRest(): RestFill | null {
  if (!existsSync(REST_FILE)) return null;
  try {
    const r = JSON.parse(readFileSync(REST_FILE, 'utf8')) as RestFill;
    return r.built_at === today ? r : null;
  } catch { return null; }
}

/** Atomic write (temp + rename) so the foreground never reads a partial file. */
function writeRest(r: RestFill): void {
  const tmp = `${REST_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r));
  renameSync(tmp, REST_FILE);
}

function clearRest(): void {
  if (existsSync(REST_FILE)) rmSync(REST_FILE);
}

/**
 * Spawn a detached `--fill` child that expands ALL channels in parallel while the
 * foreground emits the first video. The child writes queue-rest.json only (never touches
 * queue.json / state.md). Best-effort: if it dies, the foreground expands channels itself.
 */
function spawnBackgroundFill(): void {
  const child = spawn(RUNTIME, [script('yt-sweep'), '--fill'], {
    cwd: PKG_ROOT,
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function emit(obj: { status: string; [k: string]: unknown }): never {
  log(`EXIT status=${obj.status}`);
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

// ---------- LLM gates ----------

/** Title filter: batch-classify a channel's non-baseline titles. Falls back to keep-all on any error. */
async function runTitleFilter(profilePathAbs: string, videos: QueueItem[]): Promise<Set<string>> {
  const skip = new Set<string>();
  if (!existsSync(profilePathAbs)) return skip;
  const profile = readFileSync(profilePathAbs, 'utf8');
  if (!/##\s*Skip titles/.test(profile)) return skip;
  const toClassify = videos.filter(v => !v.is_baseline);
  if (toClassify.length === 0) return skip;

  const prompt = `Title-filter batch classification for a YouTube briefing tool.

Channel profile:
${profile}

Focus on the '## Skip titles' section (titles to skip) and any '## Notes' rules.
Keep by default — only skip a title that clearly matches the worthless pattern. If that section is missing or empty: classify all as keep.

Videos:
${JSON.stringify(toClassify.map(v => ({ id: v.videoId, title: v.title, type: v.type })))}

Output ONLY a raw JSON array (no markdown fences, no explanation):
[{"id":"VIDEO_ID","result":"keep"},{"id":"VIDEO_ID","result":"skip","reason":"max 12 words"},...]`;

  let out: string;
  try {
    out = await chat(prompt, {
      system: "You are a video title classifier. Output ONLY a raw JSON array as instructed. No markdown fences, no explanation.",
      model: getModel(),
      temperature: 0,
    });
  } catch { return skip; }

  try {
    const start = out.indexOf('['), end = out.lastIndexOf(']');
    if (start === -1 || end === -1) return skip;
    const parsed: Array<{ id: string; result: string }> = JSON.parse(out.slice(start, end + 1));
    for (const r of parsed) if (r.result === 'skip') skip.add(r.id);
  } catch { /* keep-all */ }
  return skip;
}

/** Content filter: substance check + summary in the configured language. Returns markdown, or 'OFFTOPIC: <reason>'. */
async function runContentFilter(item: QueueItem, transcript: string): Promise<string> {
  const profile = existsSync(item.profile_path) ? readFileSync(item.profile_path, 'utf8') : '';
  const baselineNote = item.is_baseline ? ' · baseline' : '';
  const profileSection = profile
    ? `\nChannel profile (sections to honor: Channel policy, Summary format, Cut sections, Episode types, Notes):\n${profile}\n`
    : '';

  const prompt = `Write a summary of this YouTube video in ${LANG}, OR return 'OFFTOPIC: <reason>' if the transcript clearly does not match what the title/channel promises.

Video:
- videoId: ${item.videoId}
- channel: ${item.channel}
- title: ${item.title}
- type: ${item.type}
- publishedAt: ${item.publishedAt}
- url: https://youtube.com/watch?v=${item.videoId}

Transcript:
${transcript}
${profileSection}
Steps:
1. Substance check: does the transcript actually deliver what the title promises? If clearly not → output ONLY 'OFFTOPIC: <short reason>' and stop.
2. Otherwise write the summary:
   - Header: ### ${item.channel} — "${item.title}"
   - Subtitle: _${item.publishedAt} · ${item.type} · https://youtube.com/watch?v=${item.videoId}${baselineNote}_
   - 2-5 numbered thematic sections × 2-5 sentences each
   - At most 5-8 short quotes from the transcript
   - No timestamps
3. Language: natural ${LANG}. Avoid calques/anglicisms; use foreign words only for proper nouns or established technical terms. Section headers should be verb phrases, not noun stacks.
4. Output: ONLY the summary OR 'OFFTOPIC: ...'. No preamble, no trailing commentary.`;

  return await chat(prompt, {
    system: `You are a video summarizer writing in ${LANG}. Follow the task instructions exactly. Output only the summary or 'OFFTOPIC: <reason>'. No preamble, no commentary.`,
    model: getModel(),
  });
}

// ---------- queue build (lazy: list channels now, expand on demand) ----------

/** Map channels.md → channel refs (handle + absolute profile path). */
function channelRefs(): ChannelRef[] {
  return parseChannels(readFileSync(CHANNELS_MD, 'utf8'))
    .map(c => ({ handle: c.handle, profile_path: profilePath(c.slug) }));
}

/**
 * Expand one channel: fetch its pending videos + run the title filter. PURE w.r.t.
 * state.md / queue.json — returns kept items and the title-skips for the caller to
 * persist. Shared by the foreground fallback and the background --fill child.
 */
async function expandChannel(ref: ChannelRef): Promise<{ items: QueueItem[]; skips: SkipRef[] }> {
  const t = Date.now();
  const { stdout, code } = await run([RUNTIME, script('yt-channel-pending'), ref.handle]);
  log(`  pending ${ref.handle} ${Date.now() - t}ms`);
  const videos: any[] = code === 0 ? (JSON.parse(stdout || '[]') as any[]) : [];
  if (videos.length === 0) return { items: [], skips: [] };
  const candidates: QueueItem[] = videos.map(v => ({
    channel: ref.handle, profile_path: ref.profile_path,
    videoId: v.videoId, title: v.title, type: v.type,
    publishedAt: v.publishedAt, is_baseline: v.is_baseline,
  }));
  const titleSkip = await runTitleFilter(ref.profile_path, candidates);
  const items: QueueItem[] = [];
  const skips: SkipRef[] = [];
  for (const it of candidates) {
    if (titleSkip.has(it.videoId)) skips.push({ channel: it.channel, type: it.type, videoId: it.videoId });
    else items.push(it);
  }
  return { items, skips };
}

/**
 * Init the lazy queue (cheap — no API): list every channel as todo, no items yet,
 * then spawn the background fill so the rest is computed while the foreground emits
 * the first video.
 */
function buildQueue(): Queue {
  clearPrefetch();   // fresh run → drop any prefetch left from a previous queue
  clearRest();
  const channels_todo = channelRefs();
  const queue: Queue = { built_at: today, channels_todo, items: [], seen: [] };
  writeFileSync(QUEUE_FILE, JSON.stringify(queue));
  log(`queue init: ${channels_todo.length} channels to expand`);
  spawnBackgroundFill();
  return queue;
}

/**
 * Merge a ready background fill into the queue: apply its title-skips to state.md,
 * dedup-append its items, and clear channels_todo. No-op if no fresh fill is on disk.
 */
function mergeRest(queue: Queue): boolean {
  const rest = loadRest();
  if (!rest) return false;
  applyTitleSkips(rest.skips);
  enqueue(queue, rest.items);
  queue.channels_todo = [];
  clearRest();
  log(`merged background fill: +${rest.items.length} items`);
  return true;
}

/**
 * Guarantee the queue has at least one item to look at (or no channels left). First
 * tries to consume the background fill; if it isn't ready, expands channels in the
 * foreground itself so we never block on the background.
 */
async function ensureItems(queue: Queue): Promise<void> {
  mergeRest(queue);
  while (queue.items.length === 0 && queue.channels_todo.length > 0) {
    // Expand a WAVE of channels in parallel rather than one at a time: each cold
    // expansion is a few network round trips, so a wave costs ~one expansion of wall
    // time instead of N sequential ones — that was 70% of cold first-paint. Foreground
    // stays the sole writer: gather the wave, then apply skips + enqueue here.
    const wave = queue.channels_todo.splice(0, CONCURRENCY);
    const results = await Promise.all(
      wave.map(ref => expandChannel(ref).catch(() => ({ items: [], skips: [] }))),
    );
    for (const { items, skips } of results) {
      applyTitleSkips(skips);
      enqueue(queue, items);
    }
    writeFileSync(QUEUE_FILE, JSON.stringify(queue));
    mergeRest(queue);   // background may have finished while we expanded
  }
}

function loadQueue(): Queue | null {
  if (!existsSync(QUEUE_FILE)) return null;
  try {
    const q = JSON.parse(readFileSync(QUEUE_FILE, 'utf8')) as Queue;
    // Resume only a same-day queue of the current shape. A day-old queue is stale →
    // rebuild so newly published videos appear.
    if (q.built_at !== today) return null;
    if (!Array.isArray(q.channels_todo) || !Array.isArray(q.items)) return null;
    if (!Array.isArray(q.seen)) q.seen = [];   // normalize older same-day caches
    return q;
  } catch { return null; }
}

// ---------- advance (the lazy step) ----------

/** state.md pointer for this item's type, or null if the channel has no row yet. */
function statePointer(item: QueueItem): string | null {
  const row = parseState(readFileSync(STATE_MD, 'utf8')).find(r => r.handle === item.channel);
  if (!row) return null;
  return item.type === 'longform' ? row.last_longform_id
    : item.type === 'short' ? row.last_short_id : row.last_live_id;
}

type ItemResult =
  | { kind: 'ratable'; summary: string }
  | { kind: 'skip'; status: 'no_transcript' | 'content_skip' }
  | { kind: 'rate_limited' };

/**
 * Pure-ish pipeline for one queue item: fetch transcript → substance check + summary.
 * No side effects on state.md / queue / pending — the caller decides what to do with the
 * result. Shared by the foreground advance and the --prefetch child.
 */
async function processItem(item: QueueItem): Promise<ItemResult> {
  const tT = Date.now();
  const t = await run([RUNTIME, script('yt-transcript'), item.videoId, '--lang', 'auto']);
  log(`transcript ${item.videoId} ${Date.now() - tT}ms (exit ${t.code})`);
  if (t.code === 2) return { kind: 'rate_limited' };
  if (t.code !== 0) return { kind: 'skip', status: 'no_transcript' };
  if (!t.stdout.trim()) return { kind: 'skip', status: 'content_skip' };

  const tC = Date.now();
  const summary = await runContentFilter(item, t.stdout);
  log(`content ${item.videoId} ${Date.now() - tC}ms`);
  if (summary.startsWith('OFFTOPIC:')) return { kind: 'skip', status: 'content_skip' };
  return { kind: 'ratable', summary };
}

async function advance(queue: Queue): Promise<never> {
  while (true) {
    // Pull in the background fill (or expand a channel ourselves) until there's an
    // item to look at. Empty after this → nothing left anywhere → done.
    await ensureItems(queue);
    if (queue.items.length === 0) break;
    const item = queue.items[0]!;

    // Head already resolved last round (rated/skipped → pointer landed on it) → drop.
    if (statePointer(item) === item.videoId) { dropHead(queue); continue; }

    // Warm prefetch from the background child? Use it and skip the live fetch + content filter.
    const cached = loadPrefetch(item.videoId);
    if (cached) log(`prefetch hit ${item.videoId}`);
    const result: ItemResult = cached
      ? { kind: 'ratable', summary: cached }
      : await processItem(item);

    if (result.kind === 'rate_limited') {
      writeFileSync(QUEUE_FILE, JSON.stringify(queue));
      emit({ status: 'rate_limited' });
    }
    if (result.kind === 'skip') {
      persistSkip(item, result.status);
      dropHead(queue);
      continue;
    }

    // Ratable — hand off to the frontend. Leave item at queue head (rating bumps state,
    // next call detects pointer === videoId and drops it).
    const pending = {
      channel: item.channel, videoId: item.videoId, title: item.title,
      type: item.type, publishedAt: item.publishedAt, is_baseline: item.is_baseline,
    };
    writeFileSync(PENDING_FILE, JSON.stringify(pending));
    writeFileSync(QUEUE_FILE, JSON.stringify(queue));
    // Warm the NEXT video in the background while the user rates this one.
    spawnPrefetch(queue.items[1]);
    emit({ status: 'rating_needed', summary: result.summary, pending });
  }

  // All processed.
  if (existsSync(QUEUE_FILE)) rmSync(QUEUE_FILE);
  clearRest();
  clearPrefetch();
  emit({ status: 'done' });
}

/**
 * --prefetch mode: compute the summary for one specific queued video and cache it, with
 * NO side effects on state.md / queue / pending. Runs detached while the user rates the
 * previous video. Best-effort — silent on any failure.
 */
async function runPrefetch(videoId: string): Promise<never> {
  const queue = loadQueue();
  if (!queue) process.exit(0);
  const item = queue.items.find(i => i.videoId === videoId);
  if (!item) process.exit(0);
  if (statePointer(item) === item.videoId) process.exit(0);   // already resolved
  if (loadPrefetch(item.videoId)) process.exit(0);            // already warm
  const result = await processItem(item);
  if (result.kind === 'ratable') {
    writePrefetch({ videoId: item.videoId, summary: result.summary, built_at: today });
  }
  process.exit(0);
}

/**
 * --fill mode: expand EVERY channel in parallel (bounded) and write the result to
 * queue-rest.json for the foreground to merge. PURE — never writes state.md or
 * queue.json. Best-effort: a single channel's failure must not sink the whole fill.
 */
async function runFill(): Promise<never> {
  if (loadRest()) process.exit(0);   // already filled this run
  const refs = channelRefs();
  const allItems: QueueItem[] = [];
  const allSkips: SkipRef[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < refs.length) {
      const ref = refs[idx++]!;
      try {
        const { items, skips } = await expandChannel(ref);
        allItems.push(...items);
        allSkips.push(...skips);
      } catch { /* one channel down must not sink the fill */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refs.length || 1) }, () => worker()));
  writeRest({ built_at: today, items: allItems, skips: allSkips });
  log(`fill done: ${allItems.length} items, ${allSkips.length} skips`);
  process.exit(0);
}

// ---------- entry ----------

if (prefetchTarget) {
  await runPrefetch(prefetchTarget);   // detached background warmup — never returns
}
if (fillMode) {
  await runFill();                     // detached background queue builder — never returns
}
if (reset) {
  if (existsSync(QUEUE_FILE)) rmSync(QUEUE_FILE);
  if (existsSync(PENDING_FILE)) rmSync(PENDING_FILE);
  clearRest();
  clearPrefetch();
}
// Fatal config preflight, foreground only (the detached --fill / --prefetch children already
// exited above). A missing key would otherwise surface as a misleading `status:"done"` ("no new
// videos") — the YouTube error is collapsed by the per-channel catch, and a missing LLM key is
// swallowed by the title-filter's keep-all fallback. Fail fast naming every missing var instead.
{
  const missing = missingEnv([...REQUIRED_LLM, ...REQUIRED_YOUTUBE]);
  if (missing.length) emit({ status: 'error', error: missingEnvMessage(missing) });
}
const queue = loadQueue() ?? buildQueue();
await advance(queue);
