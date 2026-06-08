#!/usr/bin/env node
/**
 * Usage: bun src/yt-transcript.ts VIDEO_ID_OR_URL [--lang pl|en|auto]
 * Accepts: bare 11-char video ID, youtube.com/watch?v=..., or youtu.be/... URL.
 * Output: plain text transcript on stdout
 * Exit 1 if the video genuinely has no subtitles — caller should skip this video.
 * Exit 2 if YouTube rate-limited / blocked the IP (caller may retry later).
 * Exit 3 on a tooling/integration failure (yt-dlp missing, spawn error, fetch
 *   error, unavailable/private video, empty/unparseable track, bad input). This
 *   is NOT a missing-captions case — stderr carries the real cause, so the caller
 *   must surface it verbatim and never report it as "no subtitles".
 * Uses yt-dlp for subtitle extraction (handles all YouTube caption formats).
 *
 * yt-dlp lookup (so a project-local install needs no global PATH pollution):
 *   1. $YT_BRIEFING_DLP_PATH if set
 *   2. <package>/bin/yt-dlp  (yt-dlp.exe on Windows) if present
 *   3. `yt-dlp` on PATH       (yt-dlp.exe on Windows)
 * See README.md → Requirements for per-OS install methods.
 *
 * YT_BRIEFING_PROXY env (optional): HTTP proxy URL — required on datacenter/VPS IPs which
 *   YouTube blocks. Example: YT_BRIEFING_PROXY=http://127.0.0.1:1080 (Cloudflare WARP via
 *   Docker). See docs/warp-proxy.md.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.ts';
import { CACHE_DIR } from './lib/paths.ts';

// Load .env so YT_BRIEFING_PROXY is set when run standalone under Node (Bun auto-loads it; Node doesn't).
// When spawned by yt-sweep, the parent already loaded it and the child inherits the env.
loadEnv();

/** Resolve the yt-dlp binary: explicit env → project-local ./bin → PATH (Windows-aware). */
function resolveYtDlp(): string {
  if (process.env.YT_BRIEFING_DLP_PATH) return process.env.YT_BRIEFING_DLP_PATH;
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const local = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', exe);
  return existsSync(local) ? local : exe;   // bare name → looked up on PATH
}
const YT_DLP = resolveYtDlp();

const args = process.argv.slice(2);
const rawInput = args[0];
const langIdx = args.indexOf('--lang');
const preferredLang = langIdx !== -1 ? args[langIdx + 1]! : 'auto';

if (!rawInput) {
  console.error('Usage: yt-briefing transcribe VIDEO_ID_OR_URL [--lang pl|en|auto]');
  process.exit(3);
}

function extractVideoId(input: string): string {
  const t = input.trim();
  const watch = t.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (watch) return watch[1]!;
  const short = t.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1]!;
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  console.error(`Invalid VIDEO_ID or YouTube URL: ${input}`);
  process.exit(3);
}

const videoId = extractVideoId(rawInput);

const proxyUrl = process.env.YT_BRIEFING_PROXY;

function vttToText(vtt: string): string {
  let prev = '';
  const parts: string[] = [];
  for (const line of vtt.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('WEBVTT') || l.startsWith('Kind:') || l.startsWith('Language:') || l.includes('-->')) continue;
    const clean = l.replace(/<[^>]+>/g, '').trim();
    if (clean && clean !== prev) {
      parts.push(clean);
      prev = clean;
    }
  }
  return parts.join(' ');
}

// Keep yt-dlp's scratch subtitles inside the gitignored data cache — never OS /tmp, so all
// of the tool's transient files stay in-repo (DATA_DIR/.cache). Cleaned up below.
mkdirSync(CACHE_DIR, { recursive: true });
const tmpDir = mkdtempSync(join(CACHE_DIR, 'sub-'));
const outTemplate = join(tmpDir, 'sub');
const subLangs = preferredLang === 'auto' ? 'pl,en,en-orig,en.*' : `${preferredLang},en,pl`;

const ytdlpArgs = [
  '--no-playlist',
  '--skip-download',
  '--write-subs',
  '--write-auto-subs',
  '--sub-langs', subLangs,
  '--sub-format', 'vtt',
  '--ignore-errors',   // continue if one language track fails (e.g. 429 on pl for en-only video)
  '--no-warnings',
  '--quiet',
  '-o', outTemplate,
];
if (proxyUrl) ytdlpArgs.push('--proxy', proxyUrl);
ytdlpArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

const result = spawnSync(YT_DLP, ytdlpArgs, { encoding: 'utf8', timeout: 60_000 });

const cleanup = () => { try { rmSync(tmpDir, { recursive: true }); } catch {} };

if (result.error) {
  cleanup();
  const msg = (result.error as NodeJS.ErrnoException).code === 'ENOENT'
    ? `yt-dlp not found (looked for "${YT_DLP}") — install it or set YT_BRIEFING_DLP_PATH (see README.md → Requirements)`
    : `yt-dlp spawn error: ${result.error.message}`;
  console.error(msg);
  process.exit(3);
}

const lower = (result.stderr ?? '').toLowerCase();
const isRateLimited = lower.includes('sign in') || lower.includes('429') || lower.includes('too many') || lower.includes('captcha');

// Check VTT files first — with --ignore-errors some languages may succeed even if others 429
let vttFiles: string[] = [];
try {
  vttFiles = readdirSync(tmpDir).filter(f => f.endsWith('.vtt')).map(f => join(tmpDir, f));
} catch {}

if (vttFiles.length === 0) {
  cleanup();
  if (isRateLimited) {
    console.error(`rate limited by YouTube (IP blocked/captcha): ${videoId}`);
    process.exit(2);
  }
  // Zero subtitle files is ambiguous: the video may genuinely have no captions,
  // OR yt-dlp/the fetch failed (unavailable/private video, extractor bug, network).
  // A clean run (exit 0, no ERROR line) means there really are no captions → exit 1.
  // Anything else is a tooling/integration failure → exit 3 with the real stderr,
  // so the caller never mislabels a broken fetch as "no subtitles".
  const ytdlpFailed = result.status !== 0 || lower.includes('error');
  if (ytdlpFailed) {
    console.error(
      `could not fetch subtitles for ${videoId} (fetch/tooling error, NOT a missing-captions case):\n` +
      `${(result.stderr ?? '').trim() || `yt-dlp exited with code ${result.status}`}`,
    );
    process.exit(3);
  }
  console.error(`no subtitles published for video: ${videoId}`);
  process.exit(1);
}

let vttFile = vttFiles[0]!;
if (preferredLang !== 'auto') {
  const exact = vttFiles.find(f => f.includes(`.${preferredLang}.`));
  if (exact) vttFile = exact;
}

const text = vttToText(readFileSync(vttFile, 'utf8'));
cleanup();

if (!text.trim()) {
  // A subtitle file existed but parsed to nothing — a format/integration issue,
  // not a genuinely captionless video. Don't report it as "no subtitles".
  console.error(`subtitle track for ${videoId} parsed empty (format/integration issue)`);
  process.exit(3);
}

console.log(text);
