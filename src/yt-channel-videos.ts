#!/usr/bin/env node
/**
 * Usage:
 *   bun src/yt-channel-videos.ts @HANDLE_OR_CHANNEL_ID --since YYYY-MM-DD
 *   bun src/yt-channel-videos.ts @HANDLE_OR_CHANNEL_ID --all
 *   ... [--limit N] [--no-enrich]
 *
 * Output: JSON array [{videoId, title, publishedAt, type, durationSeconds}] on stdout (newest first)
 *   type ∈ {'short', 'live', 'longform'}:
 *     - 'short':    durationSeconds ≤ 180 (YT Shorts limit since Oct 2024), not live
 *     - 'live':     past livestream/premiere — liveStreamingDetails.actualEndTime present
 *     - 'longform': default (>180s, not live)
 *   Filtered OUT: current and upcoming live broadcasts (no transcript yet, never consumable).
 *   --no-enrich → skip the videos.list pass; type/durationSeconds omitted; no filtering.
 *
 * Requires: YT_BRIEFING_YOUTUBE_API_KEY (see .env.example). Thin CLI wrapper over lib/yt-api.ts.
 *
 * Quota: ~1 unit per page (playlistItems.list) + 1 unit per 50 videos (videos.list).
 */

import dotenv from 'dotenv';
import { ENV_PATH } from './lib/paths.ts';
import { fetchChannelVideos } from './lib/yt-api.ts';

dotenv.config({ path: ENV_PATH });

const args = process.argv.slice(2);
const handleOrId = args[0];
const sinceIdx = args.indexOf('--since');
const since: string | null = sinceIdx !== -1 && args[sinceIdx + 1] ? args[sinceIdx + 1]! : null;
const all = args.includes('--all');
const limitIdx = args.indexOf('--limit');
const limit: number | null = limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1]!, 10) : null;
const noEnrich = args.includes('--no-enrich');

if (!handleOrId || (!since && !all)) {
  console.error('Usage: yt-channel-videos @HANDLE_OR_ID (--since YYYY-MM-DD | --all) [--limit N] [--no-enrich]   (internal helper)');
  process.exit(1);
}

try {
  const out = await fetchChannelVideos(handleOrId, { since, all, limit, enrich: !noEnrich });
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
}
