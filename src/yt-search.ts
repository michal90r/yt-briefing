#!/usr/bin/env node
/**
 * yt-search.ts — ad-hoc topic search → lazy triage → comparison. The third yt-briefing mode,
 * sibling to the channel briefing (yt-sweep) and one-shot transcribe (yt-transcript).
 *
 * You describe an intent ("which terminal for coding with Claude Code"); the engine:
 *   1. expands it into a few YouTube search queries (LLM),
 *   2. runs search.list and merges candidates,
 *   3. re-ranks candidates against your intent on metadata only — title/channel/description,
 *      NO transcript yet (cheap; protects the expensive/rate-limited transcript step),
 *   4. yields ONE candidate at a time with a rich summary, lazily — never a burst of transcript
 *      fetches (a burst looks like scraping and gets the IP blocked, same reason yt-sweep is lazy),
 *   5. records your keep/skip decision; kept summaries accumulate in a cache,
 *   6. on demand synthesizes a comparison across everything you kept.
 *
 * Matching is descriptive, not exact-keyword: search.list already ranks by relevance, and the
 * LLM bridges intent→query (step 1) and filters noise (step 3).
 *
 * Usage (the skill / CLI drives these; one JSON line per call):
 *   yt-search "<intent>" [--reset] [--max N] [--queries N] [--since DATE] [--lang auto]
 *   yt-search --keep        record the pending candidate, advance, yield next
 *   yt-search --skip        drop the pending candidate, advance, yield next
 *   yt-search --compare     synthesize a comparison from everything kept
 *
 * Output statuses:
 *   {"status":"decision_needed","summary":"<md>","pending":{videoId,title,channelTitle,publishedAt,position,total}}
 *   {"status":"done","kept":N}              queue exhausted — caller runs --compare if kept>0
 *   {"status":"compare","comparison":"<md>"}
 *   {"status":"no_results"}                 search returned nothing for the intent
 *   {"status":"rate_limited"}               transcript fetch blocked (datacenter IP — see docs/warp-proxy.md)
 *   {"status":"error","error":"<msg>"}      setup/config problem (missing key, etc.)
 *
 * Cache (all throwaway, under DATA_DIR/.cache): search-queue.json (ranked candidates + cursor),
 * search-pending.json (current candidate), search-kept.json (kept summaries = compare corpus).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { chat, getModel } from './lib/llm.ts';
import { outputLang } from './lib/config.ts';
import { searchVideos, type SearchHit } from './lib/yt-api.ts';
import {
  PKG_ROOT, ENV_PATH, CACHE_DIR,
  SEARCH_QUEUE_FILE, SEARCH_PENDING_FILE, SEARCH_KEPT_FILE, script,
} from './lib/paths.ts';

dotenv.config({ path: ENV_PATH });
mkdirSync(CACHE_DIR, { recursive: true });

const RUNTIME = process.execPath;
const LANG = outputLang();

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const flagVal = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1]! : null;
};
// First non-flag token is the intent (only on the initial / --reset call).
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--') && argv[i - 1] !== '--reset' && argv[i - 1] !== '--keep' && argv[i - 1] !== '--skip' && argv[i - 1] !== '--compare'));
const intentArg = positional[0] ?? null;

const RESET = has('--reset');
const KEEP = has('--keep');
const SKIP = has('--skip');
const COMPARE = has('--compare');
const MAX = Math.max(1, parseInt(flagVal('--max') || '8', 10));
const QUERIES = Math.max(1, Math.min(3, parseInt(flagVal('--queries') || '2', 10)));
const SINCE = flagVal('--since');
const LANGTRACK = flagVal('--lang') || 'auto';

interface Candidate extends SearchHit { score?: number; reason?: string; }
interface SearchQueue { built_at: string; intent: string; candidates: Candidate[]; cursor: number; }
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

/** Strip ```fences``` and slice the outermost JSON array from an LLM reply. */
function parseJsonArray(out: string): any[] | null {
  const start = out.indexOf('['), end = out.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(out.slice(start, end + 1)); } catch { return null; }
}

// ---------- stage 1: intent → search queries ----------
async function expandQueries(intent: string): Promise<string[]> {
  const prompt = `A user wants to research a topic on YouTube. Turn their intent into up to ${QUERIES} effective YouTube search queries (short, keyword-rich, the way people actually search). Cover slightly different angles if useful. Use the language the topic is most discussed in (usually English for tech).

Intent: "${intent}"

Output ONLY a raw JSON array of strings, no fences, no commentary. Example: ["query one","query two"]`;
  try {
    const out = await chat(prompt, { system: 'You output ONLY a raw JSON array of search-query strings.', temperature: 0.4 });
    const arr = parseJsonArray(out);
    const qs = (arr ?? []).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, QUERIES);
    return qs.length ? qs : [intent];
  } catch {
    return [intent];   // expansion is best-effort; fall back to the raw intent
  }
}

// ---------- stage 3: re-rank candidates against intent (metadata only) ----------
async function rerank(intent: string, hits: SearchHit[]): Promise<Candidate[]> {
  if (hits.length === 0) return [];
  const compact = hits.map(h => ({ id: h.videoId, title: h.title, channel: h.channelTitle, published: h.publishedAt, desc: (h.description || '').slice(0, 280) }));
  const prompt = `Rank these YouTube videos by how well they serve the user's intent. Judge on title + channel + description only (no transcripts). Drop clearly off-topic, clickbait, or duplicate-angle results.

Intent: "${intent}"

Candidates:
${JSON.stringify(compact)}

Output ONLY a raw JSON array, best first, no fences:
[{"id":"VIDEO_ID","keep":true,"score":0-100,"reason":"max 12 words"},...]
Set keep=false for anything not worth the user's time.`;
  try {
    const out = await chat(prompt, { system: 'You output ONLY a raw JSON array as instructed.', temperature: 0 });
    const arr = parseJsonArray(out);
    if (!arr) return hits.map(h => ({ ...h }));   // fall back: keep all, original order
    const byId = new Map(hits.map(h => [h.videoId, h]));
    const ranked: Candidate[] = [];
    for (const r of arr) {
      if (!r || r.keep === false) continue;
      const h = byId.get(r.id);
      if (h) ranked.push({ ...h, score: typeof r.score === 'number' ? r.score : undefined, reason: r.reason });
    }
    return ranked.length ? ranked : hits.map(h => ({ ...h }));
  } catch {
    return hits.map(h => ({ ...h }));
  }
}

// ---------- mega-summary for one candidate (the triage artifact) ----------
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

// ---------- stage 6: comparison across kept summaries ----------
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

// ---------- lazy yield: advance to the next candidate that has a transcript ----------
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

// ---------- main ----------
async function main(): Promise<void> {
  if (!process.env.YT_BRIEFING_YOUTUBE_API_KEY && (RESET || (intentArg && !loadQueue()))) {
    emit({ status: 'error', error: 'YT_BRIEFING_YOUTUBE_API_KEY is not set — add a YouTube Data API v3 key to .yt-briefing/.env (see README → setup / .env.example).' });
  }

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
    if (!queue) emit({ status: 'error', error: 'No active search. Start one: yt-search "<intent>".' });
    if (KEEP) {
      const pending = readJSON<Kept | null>(SEARCH_PENDING_FILE, null);
      if (pending) { const kept = loadKept(); kept.push(pending); writeJSON(SEARCH_KEPT_FILE, kept); }
    }
    queue!.cursor++;
    writeJSON(SEARCH_QUEUE_FILE, queue);
    await yieldNext(queue!);
  }

  // Resume an in-progress search (bare call, same intent) without rebuilding.
  const existing = loadQueue();
  if (existing && !RESET && (!intentArg || intentArg === existing.intent)) {
    await yieldNext(existing);
  }

  // Fresh search (new intent or --reset).
  if (!intentArg) emit({ status: 'error', error: 'Provide an intent: yt-search "<what to research>".' });
  const queries = await expandQueries(intentArg);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const q of queries) {
    let batch: SearchHit[] = [];
    try { batch = await searchVideos(q, { maxResults: 10, since: SINCE }); }
    catch (e) { emit({ status: 'error', error: (e as Error).message }); }
    for (const h of batch) if (!seen.has(h.videoId)) { seen.add(h.videoId); hits.push(h); }
  }
  if (hits.length === 0) emit({ status: 'no_results' });

  const ranked = (await rerank(intentArg, hits)).slice(0, MAX);
  if (ranked.length === 0) emit({ status: 'no_results' });

  const queue: SearchQueue = { built_at: new Date().toISOString(), intent: intentArg, candidates: ranked, cursor: 0 };
  writeJSON(SEARCH_QUEUE_FILE, queue);
  writeJSON(SEARCH_KEPT_FILE, []);   // fresh search → fresh compare corpus
  await yieldNext(queue);
}

main().catch(err => emit({ status: 'error', error: (err as Error).message }));
