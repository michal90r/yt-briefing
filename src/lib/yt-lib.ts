/**
 * Shared utilities for yt-briefing: channels.md / state.md parsing and channel-profile
 * editing. Pure string functions where possible — the caller does the I/O.
 *
 * The data files are human-editable Markdown on purpose: a channel profile is meant to
 * be read and tweaked by hand, and ratings append to it as plain bullet lists.
 */

/** Canonical profile section headings (single source — used by the engine and rating writer). */
export const SKIP_TITLES_HEADING = '## Skip titles';
export const NOTES_HEADING = '## Notes';

export interface ChannelEntry {
  handle: string;       // @AsianBoss
  category: string;     // world-and-economy
  slug: string;         // asian-boss   (profile lives at <DATA_DIR>/channels/<slug>.md)
  policy: string;       // base category policy text
}

export interface StateRow {
  handle: string;
  category: string;
  last_longform_id: string | null;
  last_short_id: string | null;
  last_live_id: string | null;
  updated: string | null;
  session: number;
}

const NULL_CELL = /^[—\-]$/;

// ---------- channels.md ----------

export function parseChannels(content: string): ChannelEntry[] {
  const entries: ChannelEntry[] = [];
  const lines = content.split('\n');
  let category: string | null = null;
  let policy = '';
  let inPolicy = false;
  let inChannels = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const catMatch = line.match(/^## Category:\s*(.+?)\s*$/);
    if (catMatch) {
      category = catMatch[1]!;
      policy = '';
      inPolicy = false;
      inChannels = false;
      continue;
    }

    if (line.trim().startsWith('**Base policy:**')) {
      inPolicy = true;
      inChannels = false;
      continue;
    }

    if (line.trim() === '**Channels:**') {
      inPolicy = false;
      inChannels = true;
      continue;
    }

    if (inPolicy && line.trim() && !line.startsWith('#')) {
      policy = policy ? `${policy}\n${line.trim()}` : line.trim();
    } else if (inPolicy && (line.startsWith('##') || line.startsWith('---'))) {
      inPolicy = false;
    }

    if (inChannels && category) {
      // - [@Handle](url) → [[channels/slug]]
      const m = line.match(/^-\s*\[(@[^\]]+)\]\([^)]+\)\s*→\s*\[\[channels\/([^\]]+)\]\]/);
      if (m) {
        entries.push({ handle: m[1]!, category, slug: m[2]!, policy });
      }
    }
  }

  return entries;
}

// ---------- state.md ----------

export function parseState(content: string): StateRow[] {
  const rows: StateRow[] = [];
  const lines = content.split('\n');
  let category: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const catMatch = line.match(/^##\s+([a-z][a-z0-9-]*)\s*$/);
    if (catMatch) {
      category = catMatch[1]!;
      continue;
    }

    // Table row: | @Handle | id | id | id | date | int |
    if (line.startsWith('| @') && category) {
      const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length !== 6) continue;
      const [handle, lf, sh, lv, updated, session] = cells as [string, string, string, string, string, string];
      rows.push({
        handle,
        category,
        last_longform_id: NULL_CELL.test(lf) ? null : lf,
        last_short_id: NULL_CELL.test(sh) ? null : sh,
        last_live_id: NULL_CELL.test(lv) ? null : lv,
        updated: NULL_CELL.test(updated) ? null : updated,
        session: NULL_CELL.test(session) ? 0 : parseInt(session, 10) || 0,
      });
    }
  }

  return rows;
}

export function bumpStateFrontmatterDate(content: string, date: string): string {
  return content.replace(/^updated:\s*\d{4}-\d{2}-\d{2}/m, `updated: ${date}`);
}

/**
 * Per-video pointer bump. Updates one type's last_id for one channel.
 * Session counter increments only on first touch of the day (updated != date).
 * Also bumps frontmatter `updated`.
 */
export function bumpStatePointer(
  content: string,
  handle: string,
  type: 'longform' | 'short' | 'live',
  videoId: string,
  date: string,
): string {
  const lines = content.split('\n');
  let touched = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith(`| ${handle} |`)) continue;
    const cells = line.split('|');
    if (cells.length < 8) continue;

    const cur = {
      lf: cells[2]!.trim(),
      sh: cells[3]!.trim(),
      lv: cells[4]!.trim(),
      updated: cells[5]!.trim(),
      session: cells[6]!.trim(),
    };

    if (type === 'longform') cur.lf = videoId;
    else if (type === 'short') cur.sh = videoId;
    else if (type === 'live') cur.lv = videoId;

    const sessionNum = NULL_CELL.test(cur.session) ? 0 : parseInt(cur.session, 10) || 0;
    if (cur.updated !== date) {
      cur.session = String(sessionNum + 1);
      cur.updated = date;
    }

    lines[i] = `| ${handle} | ${cur.lf} | ${cur.sh} | ${cur.lv} | ${cur.updated} | ${cur.session} |`;
    touched = true;
    break;
  }
  if (!touched) throw new Error(`bumpStatePointer: row for ${handle} not found`);

  return bumpStateFrontmatterDate(lines.join('\n'), date);
}

// ---------- channel profile: durable signal writes ----------

/**
 * Append `line` under `## <section>`, creating the section if missing (before `## Notes`
 * when present, unless we ARE Notes — then at EOF), FIFO-capping the section's bullets to
 * `cap`. Dedup: no-op if an identical bullet already exists. The profile is the durable
 * store — there is no rolling buffer / consolidation; a rating writes straight here.
 */
export function appendToSection(
  profileContent: string,
  heading: string,
  line: string,
  cap: number = Infinity,
): string {
  const lines = profileContent.split('\n');
  let hi = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.trim() === heading) { hi = i; break; }

  if (hi === -1) {
    let insertAt = lines.length;
    if (heading !== NOTES_HEADING) {
      for (let i = 0; i < lines.length; i++) if (lines[i]!.trim() === NOTES_HEADING) { insertAt = i; break; }
    }
    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);
    while (before.length && before[before.length - 1]!.trim() === '') before.pop();
    const section = [heading, '', line, ''].join('\n');
    const segments = [before.join('\n'), '', section];
    if (after.length) segments.push(after.join('\n'));
    return segments.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  let end = lines.length;
  for (let i = hi + 1; i < lines.length; i++) if (lines[i]!.startsWith('## ')) { end = i; break; }
  const body = lines.slice(hi + 1, end).filter(l => l.trim().startsWith('- '));
  if (body.some(l => l.trim() === line.trim())) return profileContent;   // dedup
  body.push(line);
  while (body.length > cap) body.shift();   // FIFO

  const before = lines.slice(0, hi);
  const after = lines.slice(end);
  while (before.length && before[before.length - 1]!.trim() === '') before.pop();
  while (after.length && after[0]!.trim() === '') after.shift();
  const section = [heading, '', ...body, ''].join('\n');
  const segments = [before.join('\n'), '', section];
  if (after.length) segments.push(after.join('\n'));
  return segments.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** A `rating=0` writes a compact negative few-shot to `## Skip titles` (FIFO cap, default 10). */
export function appendSkipTitle(
  profileContent: string,
  entry: { title: string; type: string; comment?: string },
  cap: number = 10,
): string {
  const why = entry.comment && entry.comment.trim() ? ` · ${entry.comment.trim()}` : '';
  const line = `- "${entry.title.replace(/"/g, "'")}" — ${entry.type}${why}`;
  return appendToSection(profileContent, SKIP_TITLES_HEADING, line, cap);
}

/** A comment writes a durable rule to `## Notes` (uncapped — manual curation territory). */
export function appendNote(profileContent: string, rule: string): string {
  return appendToSection(profileContent, NOTES_HEADING, `- ${rule.trim()}`);
}
