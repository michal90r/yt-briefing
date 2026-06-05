/**
 * Filesystem layout for yt-briefing — the single source of truth for every path.
 *
 * Three roots:
 *   PKG_ROOT   the installed package (code + the compiled dist/).
 *   BASE_DIR   where the user's secrets + state live. In a dev clone (you run the package
 *              itself) this IS the package root, so the repo layout (`.env`, `data/`) is
 *              unchanged. When the package is *consumed as a dependency* — PKG_ROOT sits
 *              inside node_modules — that would be wiped on reinstall, so BASE_DIR moves to
 *              `<your project>/.yt-briefing/` instead. Override explicitly with YT_BASE_DIR.
 *   DATA_DIR   the mutable state (subscriptions, profiles, cursor, throwaway cache).
 *              Defaults to <BASE_DIR>/data; override with YT_DATA_DIR to keep it anywhere
 *              (e.g. a synced git folder, separate from secrets).
 *
 * BASE_DIR and DATA_DIR are pinned back into the environment so detached child processes —
 * which we spawn with `cwd: PKG_ROOT`, a *different* cwd — resolve to the exact same folders.
 *
 * Nothing here reads the disk — it only resolves paths, so it is safe to import from every
 * script and from the bootstrap wizard before any data exists.
 */
import { join, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);            // …/lib/paths.ts (dev) or …/lib/paths.js (built)
const HERE = dirname(SELF);                             // src/lib  or  dist/lib
export const SRC_DIR = resolve(HERE, '..');             // src       or  dist
export const PKG_ROOT = resolve(HERE, '../..');         // package root
/** This build's script extension: '.ts' running from source under Bun, '.js' when compiled. */
const SCRIPT_EXT = extname(SELF) || '.ts';

// Consumed as a dependency? Then PKG_ROOT lives under node_modules and must not hold user state.
const CONSUMED = PKG_ROOT.split(sep).includes('node_modules');
export const BASE_DIR = process.env.YT_BASE_DIR
  ? resolve(process.env.YT_BASE_DIR)
  : CONSUMED ? join(process.cwd(), '.yt-briefing') : PKG_ROOT;
process.env.YT_BASE_DIR = BASE_DIR;                    // pin for children (their cwd differs)

export const ENV_PATH = join(BASE_DIR, '.env');

export const DATA_DIR = process.env.YT_DATA_DIR
  ? resolve(process.env.YT_DATA_DIR)
  : join(BASE_DIR, 'data');
process.env.YT_DATA_DIR = DATA_DIR;                    // pin for children (their cwd differs)

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

/**
 * Absolute path to a sibling engine script by its base name (no extension), so subprocess
 * calls never depend on cwd and resolve to `.ts` in dev or `.js` once compiled to dist/.
 */
export const script = (base: string): string => join(SRC_DIR, base + SCRIPT_EXT);
