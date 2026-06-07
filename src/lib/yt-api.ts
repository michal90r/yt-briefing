/**
 * yt-api.ts — YouTube Data API v3 client over plain `fetch` (no SDK).
 *
 * Replaces the monolithic `googleapis` import, whose multi-thousand-file module tree
 * cost ~7s to load from a cold FS cache on every fresh process. The Data API is a
 * trivial REST surface, so direct fetch keeps cold-start near the runtime's own startup.
 *
 * Auth: YT_BRIEFING_YOUTUBE_API_KEY — the entrypoint loads it (dotenv.config from ENV_PATH) before
 * calling; this module only reads process.env at call time.
 */

export interface Video {
  videoId: string;
  title: string;
  publishedAt: string;
  type?: 'short' | 'live' | 'longform';
  durationSeconds?: number;
}

export interface FetchOpts {
  /** ISO date; only videos published on/after are returned. Ignored when `all`. */
  since?: string | null;
  /** Paginate the entire uploads playlist. */
  all?: boolean;
  /** Cap to the N most recent videos. */
  limit?: number | null;
  /** Skip the videos.list pass (type/durationSeconds omitted, no live filtering). */
  enrich?: boolean;
}

const API = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  const k = process.env.YT_BRIEFING_YOUTUBE_API_KEY;
  if (!k) throw new Error('YT_BRIEFING_YOUTUBE_API_KEY env var not set (see .env.example)');
  return k;
}

async function get(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, key: apiKey() }).toString();
  const res = await fetch(`${API}/${path}?${qs}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** handle (@x) or channelId (UC…) → uploads playlist id. */
async function resolveUploadsPlaylist(handleOrId: string): Promise<string> {
  const params: Record<string, string> = { part: 'contentDetails' };
  if (handleOrId.startsWith('@')) params.forHandle = handleOrId.slice(1);
  else params.id = handleOrId;
  const data = await get('channels', params);
  const items = data.items;
  if (!items?.length) throw new Error(`Channel not found: ${handleOrId}`);
  return items[0].contentDetails.relatedPlaylists.uploads as string;
}

async function listUploads(playlistId: string, since: string | null, maxCount: number | null): Promise<Video[]> {
  const sinceTs = since ? new Date(since).getTime() : 0;
  const videos: Video[] = [];
  let pageToken: string | undefined;

  while (true) {
    const params: Record<string, string> = {
      part: 'snippet',
      playlistId,
      maxResults: String(maxCount !== null ? Math.min(maxCount, 50) : 50),
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await get('playlistItems', params);

    const items = data.items || [];
    let hitOld = false;
    for (const item of items) {
      const publishedAt: string = item.snippet.publishedAt;
      if (since && new Date(publishedAt).getTime() < sinceTs) { hitOld = true; break; }
      videos.push({ videoId: item.snippet.resourceId.videoId, title: item.snippet.title, publishedAt });
      if (maxCount !== null && videos.length >= maxCount) return videos;
    }
    if (hitOld || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return videos;
}

function parseDurationISO8601(iso: string): number {
  // PT#H#M#S — any segment may be absent. Examples: PT45S, PT3M12S, PT1H2M3S.
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseFloat(m[3]) : 0;
  return h * 3600 + min * 60 + Math.round(s);
}

async function enrichWithTypes(videos: Video[]): Promise<Video[]> {
  const out: Video[] = [];
  for (let i = 0; i < videos.length; i += 50) {
    const chunk = videos.slice(i, i + 50);
    const data = await get('videos', {
      part: 'contentDetails,snippet,liveStreamingDetails',
      id: chunk.map(v => v.videoId).join(','),
    });
    const byId = new Map<string, any>();
    for (const item of data.items || []) byId.set(item.id, item);

    for (const v of chunk) {
      const item = byId.get(v.videoId);
      if (!item) {
        // metadata fetch failed for this id — treat as longform with unknown duration
        v.type = 'longform';
        v.durationSeconds = 0;
        out.push(v);
        continue;
      }
      const liveFlag = item.snippet?.liveBroadcastContent;
      if (liveFlag === 'live' || liveFlag === 'upcoming') continue;   // not consumable yet
      const duration = parseDurationISO8601(item.contentDetails?.duration || 'PT0S');
      v.durationSeconds = duration;
      const isPastLive = !!item.liveStreamingDetails?.actualEndTime;
      v.type = isPastLive ? 'live' : duration <= 180 ? 'short' : 'longform';
      out.push(v);
    }
  }
  return out;
}

/** A search.list hit — carries the snippet fields a relevance re-rank needs (no transcript yet). */
export interface SearchHit {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  description: string;
}

/**
 * Free-text video search via `search.list`. YouTube ranks by relevance, so the query can be
 * descriptive — no exact keyword match required. NOTE: search.list costs 100 quota units per
 * call (plain reads cost 1), so callers should keep the number of queries small.
 *
 * `since` (ISO date) maps to publishedAfter — useful to cut stale results on fast-moving topics.
 */
export async function searchVideos(
  query: string,
  opts: { maxResults?: number; since?: string | null } = {},
): Promise<SearchHit[]> {
  const { maxResults = 10, since = null } = opts;
  const params: Record<string, string> = {
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'relevance',
    maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
  };
  if (since) params.publishedAfter = new Date(since).toISOString();
  const data = await get('search', params);
  return (data.items || [])
    .filter((it: any) => it.id?.videoId)
    .map((it: any) => ({
      videoId: it.id.videoId,
      title: it.snippet?.title ?? '',
      channelTitle: it.snippet?.channelTitle ?? '',
      publishedAt: it.snippet?.publishedAt ?? '',
      description: it.snippet?.description ?? '',
    }));
}

/**
 * List a channel's uploads (newest first). With `enrich` (default true) each video is
 * typed (short/live/longform) and current/upcoming live broadcasts are filtered out.
 */
export async function fetchChannelVideos(handleOrId: string, opts: FetchOpts = {}): Promise<Video[]> {
  const { since = null, all = false, limit = null, enrich = true } = opts;
  const uploads = await resolveUploadsPlaylist(handleOrId);
  const videos = await listUploads(uploads, all ? null : since, limit);
  return enrich ? enrichWithTypes(videos) : videos;
}
