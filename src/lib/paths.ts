/**
 * Filesystem layout for yt-briefing — the single source of truth for every path.
 *
 * Two roots:
 *   PKG_ROOT   the installed package (code + .env with secrets).
 *   DATA_DIR   the user's mutable state: subscriptions, per-channel profiles, the
 *              per-video cursor, and a throwaway cache. Defaults to <PKG_ROOT>/data
 *              so a fresh clone "just works"; override with YT_DATA_DIR to keep your
 *              briefing data anywhere (e.g. a synced folder, separate from the code).
 *
 * Nothing here reads the disk — it only resolves paths, so it is safe to import
 * from every script and from the bootstrap wizard before any data exists.
 */
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // src/lib
export const SRC_DIR = resolve(HERE, '..');             // src
export const PKG_ROOT = resolve(HERE, '../..');         // package root
export const ENV_PATH = join(PKG_ROOT, '.env');

export const DATA_DIR = process.env.YT_DATA_DIR
  ? resolve(process.env.YT_DATA_DIR)
  : join(PKG_ROOT, 'data');

export const CHANNELS_MD = join(DATA_DIR, 'channels.md');
export const STATE_MD = join(DATA_DIR, 'state.md');
export const CONFIG_JSON = join(DATA_DIR, 'config.json');
export const CHANNELS_DIR = join(DATA_DIR, 'channels');
export const CACHE_DIR = join(DATA_DIR, '.cache');

export const QUEUE_FILE = join(CACHE_DIR, 'queue.json');
export const REST_FILE = join(CACHE_DIR, 'queue-rest.json');
export const PENDING_FILE = join(CACHE_DIR, 'pending.json');
export const PREFETCH_FILE = join(CACHE_DIR, 'prefetch.json');
export const LOG_FILE = join(CACHE_DIR, 'sweep.log');

/** Absolute path to a channel profile from its slug. */
export const profilePath = (slug: string): string => join(CHANNELS_DIR, `${slug}.md`);

/** Absolute path to a sibling engine script, so subprocess calls never depend on cwd. */
export const script = (name: string): string => join(SRC_DIR, name);
