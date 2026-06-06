/**
 * Channel helpers — the single source for turning a handle into our canonical form and for
 * (de)serializing channels.md / state.md / a fresh profile. Used by onboarding (bootstrap)
 * and by the add/remove command, so the on-disk formats never drift apart.
 *
 * Pure strings; the callers do the file I/O.
 */
import type { ChannelEntry, StateRow } from './yt-lib.ts';

export const BASELINE_LOOKBACK_DAYS = 60;

export const today = (): string => new Date().toISOString().slice(0, 10);

// Fresh channels start "baseline": updated is set this far back so the first sweep's window
// still contains a recent upload per type (which becomes the starting point).
export const lookbackDate = (): string =>
  new Date(Date.now() - BASELINE_LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);

export const channelUrl = (handle: string): string => `https://www.youtube.com/${handle}`;

/**
 * Accept any of: `@betterstack`, `betterstack`, `https://www.youtube.com/@betterstack`
 * (with or without a trailing `/videos` etc.) → canonical `@betterstack`. Returns null if no
 * handle can be read (e.g. a bare `/channel/UC…` URL — ask the user for the @handle).
 */
export function normalizeHandle(input: string): string | null {
  let s = input.trim();
  if (/youtube\.com/i.test(s) || /^https?:\/\//i.test(s)) {
    const m = s.match(/@[\p{L}\p{N}._-]+/u);   // pull the @handle out of a URL (Unicode-aware)
    s = m ? m[0] : '';
  }
  s = s.replace(/^@+/, '');
  // Keep the leading run of handle chars — letters (any script, e.g. ł), digits, . _ - —
  // so non-ASCII handles like @DziałZagraniczny survive instead of truncating at the first ł.
  const m = s.match(/^[\p{L}\p{N}._-]+/u);
  s = m ? m[0] : '';
  return s ? `@${s}` : null;
}

/**
 * kebab-case slug that also breaks CamelCase: "BetterStack" → "better-stack". Diacritics are
 * folded to ASCII so non-Latin handles get readable slugs: "DziałZagraniczny" → "dzial-zagraniczny"
 * (ł has no NFD decomposition, so it's mapped explicitly; the rest go through NFD).
 */
export function slugify(s: string): string {
  return s
    .replace(/@/g, '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip combining diacritics (ą→a, é→e, …)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** A fresh state row for a just-added channel: no cursors yet, dated back to the lookback. */
export const baselineStateRow = (handle: string): StateRow => ({
  handle,
  last_longform_id: null,
  last_short_id: null,
  last_live_id: null,
  updated: lookbackDate(),
  session: 0,
});

/** channels.md — a flat list of the channels you follow. */
export function serializeChannels(entries: ChannelEntry[], date = today()): string {
  const parts = [
    '---', 'type: yt-config', 'name: yt-channels',
    'description: The channels you follow. Per-channel learned signal lives in channels/<slug>.md.',
    `updated: ${date}`, '---', '', '# Channels', '',
  ];
  for (const c of entries) parts.push(`- [${c.handle}](${channelUrl(c.handle)}) → [[channels/${c.slug}]]`);
  return parts.join('\n') + '\n';
}

/** state.md — one flat table; baseline rows use "—" pointers and the lookback date. */
export function serializeState(rows: StateRow[], date = today()): string {
  const parts = [
    '---', 'type: yt-state', 'name: yt-state',
    'description: Per-channel per-type cursor. The sweep reads and updates it.',
    `updated: ${date}`, '---', '', '# State', '',
    '| Channel | last_longform_id | last_short_id | last_live_id | updated | session |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    parts.push(`| ${r.handle} | ${r.last_longform_id ?? '—'} | ${r.last_short_id ?? '—'} | ${r.last_live_id ?? '—'} | ${r.updated ?? lookbackDate()} | ${r.session} |`);
  }
  return parts.join('\n') + '\n';
}

/** A fresh, empty channel profile (learned signal accumulates here as you rate). */
export function profileBody(handle: string, slug: string, date = today()): string {
  return [
    '---', 'type: yt-channel-profile', `name: ${slug}-profile`,
    `channel: ${handle}`, `channel_url: ${channelUrl(handle)}`, `updated: ${date}`,
    'sessions_observed: 0', '---', '', `# ${handle} — Profile`, '',
  ].join('\n') + '\n';
}
