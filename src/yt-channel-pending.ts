#!/usr/bin/env node
/**
 * Usage: bun src/yt-channel-pending.ts @HANDLE
 *
 * For one channel: reads state.md pointers + last-updated date,
 * fetches the channel's videos in-process via lib/yt-api.ts (--since updated),
 * filters to videos NEWER than each type's pointer (or baseline if pointer null),
 * sorts ASC by publishedAt (process oldest first → state pointer advances monotonically),
 * outputs JSON array: [{videoId, title, publishedAt, type, is_baseline}].
 *
 * Baseline (null pointer): emits ONLY the newest video of that type (others discarded).
 * Empty result is valid (channel has no new content).
 */

import { readFileSync } from 'fs';
import { loadEnv } from './lib/env.ts';
import { parseState } from './lib/yt-lib.ts';
import { STATE_MD } from './lib/paths.ts';
import { fetchChannelVideos, type Video } from './lib/yt-api.ts';

loadEnv();

interface PendingVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  type: 'longform' | 'short' | 'live';
  is_baseline: boolean;
}

const handle = process.argv[2];
if (!handle) {
  console.error('Usage: yt-channel-pending @HANDLE   (internal helper)');
  process.exit(1);
}

const state = parseState(readFileSync(STATE_MD, 'utf8'));
const row = state.find(r => r.handle === handle);
if (!row) {
  console.error(`Channel ${handle} not found in state.md`);
  process.exit(1);
}

const since = row.updated ?? '2020-01-01';
let videos: Video[];
try {
  videos = await fetchChannelVideos(handle, { since });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const pointerByType: Record<'longform' | 'short' | 'live', string | null> = {
  longform: row.last_longform_id,
  short: row.last_short_id,
  live: row.last_live_id,
};

const pending: PendingVideo[] = [];

for (const type of ['longform', 'short', 'live'] as const) {
  const pointerId = pointerByType[type];
  const ofType = videos.filter(v => v.type === type);
  if (ofType.length === 0) continue;

  // Sort by publishedAt asc; oldest first
  ofType.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

  if (pointerId === null) {
    // baseline: only emit newest of type
    const newest = ofType[ofType.length - 1]!;
    pending.push({
      videoId: newest.videoId,
      title: newest.title,
      publishedAt: newest.publishedAt,
      type,
      is_baseline: true,
    });
    continue;
  }

  // normal: find pointer's publishedAt, take everything strictly newer
  const pointerVideo = ofType.find(v => v.videoId === pointerId);
  const cutoffTs = pointerVideo
    ? new Date(pointerVideo.publishedAt).getTime()
    : // pointer not in fetched window (older than --since cutoff) — take all videos of this type from response
      -Infinity;

  for (const v of ofType) {
    if (new Date(v.publishedAt).getTime() <= cutoffTs) continue;
    pending.push({
      videoId: v.videoId,
      title: v.title,
      publishedAt: v.publishedAt,
      type,
      is_baseline: false,
    });
  }
}

// Merge sort ASC across all types for stable iteration order
pending.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

console.log(JSON.stringify(pending, null, 2));
