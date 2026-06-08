#!/usr/bin/env node
/**
 * yt-search.ts — search WITHIN one channel by intent, then lazy triage → comparison. The third
 * yt-briefing mode, sibling to the channel briefing (yt-sweep) and one-shot transcribe.
 *
 * You point it at a channel and describe what you're after ("which terminal does he recommend
 * for AI coding"); the engine:
 *   1. lists that channel's uploads (cheap — playlistItems, 1 quota unit/page; NOT search.list),
 *   2. re-ranks them against your intent on metadata only — title/description, NO transcript yet,
 *   3. yields ONE matching video at a time with a rich summary, lazily — never a burst of
 *      transcript fetches (a burst looks like scraping and gets the IP blocked),
 *   4. records your keep/skip decision; kept summaries accumulate in a cache,
 *   5. on demand synthesizes a comparison across everything you kept.
 *
 * Channel-scoped on purpose: you choose where to look. Matching is descriptive — the LLM filters
 * the channel's videos by intent (no exact-keyword needed).
 *
 * Usage (the skill / CLI drives these; one JSON line per call):
 *   yt-search "<intent>" --channel <@handle|url> [--reset] [--top N] [--scan N] [--since DATE] [--lang auto]
 *   yt-search --keep        record the pending candidate, advance, yield next
 *   yt-search --skip        drop the pending candidate, advance, yield next
 *   yt-search --compare     synthesize a comparison from everything kept
 *
 * Output statuses:
 *   {"status":"decision_needed","summary":"<md>","pending":{videoId,title,channelTitle,publishedAt,position,total}}
 *   {"status":"done","kept":N}              queue exhausted — caller runs --compare if kept>0
 *   {"status":"compare","comparison":"<md>"}
 *   {"status":"no_results"}                 the channel has no videos matching the intent
 *   {"status":"rate_limited"}               transcript fetch blocked (datacenter IP — see docs/warp-proxy.md)
 *   {"status":"error","error":"<msg>"}      setup/config problem (missing key, missing channel, …)
 *
 * Cache (all throwaway, under DATA_DIR/.cache): search-queue.json (ranked candidates + cursor),
 * search-pending.json (current candidate), search-kept.json (kept summaries = compare corpus).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { loadEnv } from './lib/env.ts';
import { chat, getModel } from './lib/llm.ts';
import { outputLang } from './lib/config.ts';
import { fetchChannelVideos, type Video } from './lib/yt-api.ts';
import { normalizeHandle } from './lib/channels.ts';
import {
  PKG_ROOT, CACHE_DIR,
  SEARCH_QUEUE_FILE, SEARCH_PENDING_FILE, SEARCH_KEPT_FILE, script,
} from './lib/paths.ts';

loadEnv();
mkdirSync(CACHE_DIR, { recursive: true });

const RUNTIME = process.execPath;
const LANG = outputLang();

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--channel', '--top', '--scan', '--since', '--lang']);
const has = (f: string) => argv.includes(f);
const flagVal = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] != null ? argv[i + 1]! : null;
};
// First token that is neither a flag nor a flag's value is the intent.
function positionalIntent(): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) { if (VALUE_FLAGS.has(a)) i++; continue; }
    if (i > 0 && VALUE_FLAGS.has(argv[i - 1]!)) continue;
    return a;
  }
  return null;
}

const intentArg = positionalIntent();
const RESET = has('--reset');
const KEEP = has('--keep');
const SKIP = has('--skip');
const COMPARE = has('--compare');
const CHANNEL = flagVal('--channel');
const TOP = Math.max(1, parseInt(flagVal('--top') || '10', 10));
const SCAN = Math.max(1, parseInt(flagVal('--scan') || '50', 10));   // recent uploads to consider when no --since
const SINCE = flagVal('--since');
const LANGTRACK = flagVal('--lang') || 'auto';

interface Candidate { videoId: string; title: string; channelTitle: string; publishedAt: string; description?: string; score?: number; reason?: string; }
interface SearchQueue { built_at: string; intent: string; channel: string; candidates: Candidate[]; cursor: number; }
interface Kept { videoId: string; title: string; channelTitle: string; publishedAt: string; summary: string; }

function emit(obj: { status: string; [k: string]: unknown }): never {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

const readJSON = <T>(p: string, fallback: T): T => {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return fallback; }
};
const writeJSON = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v));

const loadQueue = (): SearchQueue | null => readJSON<SearchQueue | null>(SEARCH_QUEUE_FILE, null);
const loadKept = (): Kept[] => readJSON<Kept[]>(SEARCH_KEPT_FILE, []);

/** Fetch a transcript via the sibling script with the launching runtime. Mirrors yt-sweep. */
function fetchTranscript(videoId: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(RUNTIME, [script('yt-transcript'), videoId, '--lang', LANGTRACK], { cwd: PKG_ROOT, env: { ...process.env } });
    let stdout = '';
    p.stdout.on('data', d => { stdout += d.toString(); });
    p.stderr.resume();
    p.on('close', code => resolve({ stdout, code: code ?? 1 }));
    p.on('error', reject);
  });
}

/** Slice the outermost JSON array from an LLM reply (tolerates stray prose / fences). */
function parseJsonArray(out: string): any[] | null {
  const start = out.indexOf('['), end = out.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(out.slice(start, end + 1)); } catch { return null; }
}

/** Re-rank a channel's videos against the intent (metadata only — no transcript). */
async function rerank(intent: string, items: Candidate[]): Promise<Candidate[]> {
  if (items.length === 0) return [];
  const compact = items.map(h => ({ id: h.videoId, title: h.title, published: h.publishedAt, desc: (h.description || '').slice(0, 280) }));
  const prompt = `From this YouTube channel's videos, pick the ones that serve the user's intent and rank them. Judge on title + description only (no transcripts). Drop anything off-topic.

Intent: "${intent}"

Videos:
${JSON.stringify(compact)}

Output ONLY a raw JSON array, best first, no fences:
[{"id":"VIDEO_ID","keep":true,"score":0-100,"reason":"max 12 words"},...]
Set keep=false for anything not relevant to the intent.`;
  try {
    const out = await chat(prompt, { system: 'You output ONLY a raw JSON array as instructed.', temperature: 0 });
    const arr = parseJsonArray(out);
    if (!arr) return items;   // fall back: keep all, original (newest-first) order
    const byId = new Map(items.map(h => [h.videoId, h]));
    const ranked: Candidate[] = [];
    for (const r of arr) {
      if (!r || r.keep === false) continue;
      const h = byId.get(r.id);
      if (h) ranked.push({ ...h, score: typeof r.score === 'number' ? r.score : undefined, reason: r.reason });
    }
    return ranked.length ? ranked : items;
  } catch {
    return items;
  }
}

/** Rich, standalone summary for one candidate — the triage artifact + compare input. */
async function megaSummary(c: Candidate, transcript: string, intent: string): Promise<string> {
  const prompt = `Summarize this YouTube video in ${LANG} for a user researching: "${intent}". Make it a RICH, standalone summary they can decide on and that will later feed a cross-video comparison — OR return 'OFFTOPIC: <reason>' if the transcript clearly doesn't serve the intent.

Video:
- title: ${c.title}
- channel: ${c.channelTitle}
- published: ${c.publishedAt}
- url: https://youtube.com/watch?v=${c.videoId}

Transcript:
${transcript}

If on-topic, write:
- Header: ### ${c.channelTitle} — "${c.title}"
- Subtitle: _${c.publishedAt} · https://youtube.com/watch?v=${c.videoId}_
- One sentence on relevance to the intent
- 3-6 numbered thematic sections × 2-4 sentences, concrete: which options/tools are discussed, the criteria, the author's verdict and reasoning. Pull out anything directly comparable (names, pros/cons, recommendations).
- A short "Bottom line for the intent" line
- At most 5-8 short quotes from the transcript. No timestamps.

Language: natural ${LANG}; foreign words only for proper nouns or established technical terms.
Output ONLY the summary OR 'OFFTOPIC: <reason>'. No preamble.`;
  return chat(prompt, {
    system: `You are a research-grade video summarizer writing in ${LANG}. Output only the summary or 'OFFTOPIC: <reason>'.`,
    model: getModel(),
  });
}

/** Synthesize a comparison across everything kept. */
async function synthesizeComparison(intent: string, kept: Kept[]): Promise<string> {
  const corpus = kept.map((k, i) => `--- VIDEO ${i + 1}: ${k.channelTitle} — "${k.title}" (${k.publishedAt})\nhttps://youtube.com/watch?v=${k.videoId}\n${k.summary}`).join('\n\n');
  const prompt = `The user researched "${intent}" and kept ${kept.length} YouTube video summaries below. Synthesize a single comparison in ${LANG} that actually helps them decide.

${corpus}

Write:
- One-paragraph bottom line answering the intent directly.
- A comparison of the concrete options/tools across the videos (a Markdown table when it fits: option · who recommends it · pros · cons · best for).
- Consensus vs disagreements between the sources.
- A final recommendation with the reasoning, and who it's for.

Language: natural ${LANG}; foreign words only for proper nouns or established technical terms. Cite videos as [1], [2]… matching the order above. Output only the comparison.`;
  return chat(prompt, { system: `You synthesize a decision-grade comparison in ${LANG}. No preamble.`, model: getModel() });
}

/** Lazy yield: advance to the next candidate that has a transcript, summarize, emit. */
async function yieldNext(queue: SearchQueue): Promise<never> {
  while (queue.cursor < queue.candidates.length) {
    const c = queue.candidates[queue.cursor]!;
    const t = await fetchTranscript(c.videoId);
    if (t.code === 2) emit({ status: 'rate_limited' });      // blocked IP — stop, don't advance
    if (t.code !== 0 || !t.stdout.trim()) {                  // no transcript → auto-skip
      queue.cursor++; writeJSON(SEARCH_QUEUE_FILE, queue); continue;
    }
    const summary = await megaSummary(c, t.stdout, queue.intent);
    if (summary.startsWith('OFFTOPIC:')) {                   // re-rank missed it → auto-skip
      queue.cursor++; writeJSON(SEARCH_QUEUE_FILE, queue); continue;
    }
    const pending: Kept = { videoId: c.videoId, title: c.title, channelTitle: c.channelTitle, publishedAt: c.publishedAt, summary };
    writeJSON(SEARCH_PENDING_FILE, pending);
    emit({
      status: 'decision_needed',
      summary,
      pending: { videoId: c.videoId, title: c.title, channelTitle: c.channelTitle, publishedAt: c.publishedAt, position: queue.cursor + 1, total: queue.candidates.length },
    });
  }
  emit({ status: 'done', kept: loadKept().length });
}

async function main(): Promise<void> {
  // --compare: synthesize from kept summaries.
  if (COMPARE) {
    const queue = loadQueue();
    const kept = loadKept();
    if (kept.length === 0) emit({ status: 'done', kept: 0 });
    const comparison = await synthesizeComparison(queue?.intent ?? '', kept);
    emit({ status: 'compare', comparison });
  }

  // --keep / --skip: record decision on the pending candidate, then advance + yield next.
  if (KEEP || SKIP) {
    const queue = loadQueue();
    if (!queue) emit({ status: 'error', error: 'No active search. Start one: yt-search "<intent>" --channel <@handle>.' });
    if (KEEP) {
      const pending = readJSON<Kept | null>(SEARCH_PENDING_FILE, null);
      if (pending) { const kept = loadKept(); kept.push(pending); writeJSON(SEARCH_KEPT_FILE, kept); }
    }
    queue!.cursor++;
    writeJSON(SEARCH_QUEUE_FILE, queue);
    await yieldNext(queue!);
  }

  // Resume an in-progress search (bare call, same intent + channel) without rebuilding.
  const existing = loadQueue();
  if (existing && !RESET && (!intentArg || intentArg === existing.intent) && (!CHANNEL || normalizeHandle(CHANNEL) === existing.channel)) {
    await yieldNext(existing);
  }

  // Fresh search: needs an intent AND a channel.
  if (!process.env.YT_BRIEFING_YOUTUBE_API_KEY) {
    emit({ status: 'error', error: 'YT_BRIEFING_YOUTUBE_API_KEY is not set — add a YouTube Data API v3 key to your project root .env (or export it / run `bun run init`). See README → Providers → Where the keys live.' });
  }
  if (!intentArg) emit({ status: 'error', error: 'Provide an intent: yt-search "<what to look for>" --channel <@handle|url>.' });
  if (!CHANNEL) emit({ status: 'error', error: 'Provide a channel: --channel <@handle|url>. /yt-search searches within one channel, not all of YouTube.' });
  const handle = normalizeHandle(CHANNEL);
  if (!handle) emit({ status: 'error', error: `Could not read a channel handle from "${CHANNEL}" — use @name or the channel URL.` });

  let videos: Video[];
  try {
    videos = await fetchChannelVideos(handle, { since: SINCE, limit: SINCE ? null : SCAN, enrich: false });
  } catch (e) {
    emit({ status: 'error', error: (e as Error).message });
  }
  if (videos!.length === 0) emit({ status: 'no_results' });

  const pool: Candidate[] = videos!.map(v => ({ videoId: v.videoId, title: v.title, channelTitle: handle, publishedAt: v.publishedAt, description: v.description }));
  const ranked = (await rerank(intentArg, pool)).slice(0, TOP);
  if (ranked.length === 0) emit({ status: 'no_results' });

  const queue: SearchQueue = { built_at: new Date().toISOString(), intent: intentArg, channel: handle, candidates: ranked, cursor: 0 };
  writeJSON(SEARCH_QUEUE_FILE, queue);
  writeJSON(SEARCH_KEPT_FILE, []);   // fresh search → fresh compare corpus
  await yieldNext(queue);
}

main().catch(err => emit({ status: 'error', error: (err as Error).message }));
