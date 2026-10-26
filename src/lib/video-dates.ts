/**
 * Publish dates of every video the sweep has listed, so a state pointer bump can refuse to
 * move back in time (see pointerWouldRegress). Kept across --reset: the pointer outlives the
 * queue. Best-effort cache — a missing or corrupt file only turns the guard off.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { VIDEO_DATES_FILE } from './paths.ts';

/** Entries older than this are dropped on write; the channel listing looks back 45 days. */
const KEEP_DAYS = 120;

export function loadVideoDates(): Record<string, string> {
  if (!existsSync(VIDEO_DATES_FILE)) return {};
  try {
    const d = JSON.parse(readFileSync(VIDEO_DATES_FILE, 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch { return {}; }
}

/** Merge newly seen videos into the cache (atomic write); no-op when nothing is new. */
export function rememberVideoDates(videos: { videoId: string; publishedAt?: string }[]): void {
  const dates = loadVideoDates();
  let changed = false;
  for (const v of videos) {
    if (!v.publishedAt || !Number.isFinite(Date.parse(v.publishedAt)) || dates[v.videoId] === v.publishedAt) continue;
    dates[v.videoId] = v.publishedAt;
    changed = true;
  }
  if (!changed) return;
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const [id, at] of Object.entries(dates)) if (Date.parse(at) < cutoff) delete dates[id];
  try {
    mkdirSync(dirname(VIDEO_DATES_FILE), { recursive: true });
    const tmp = `${VIDEO_DATES_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(dates));
    renameSync(tmp, VIDEO_DATES_FILE);
  } catch { /* best-effort: the guard is only off for dates not written */ }
}
