/**
 * Single env loader — the one place that reads secrets off disk.
 *
 * The contract is `process.env`; dotenv only fills what's missing. dotenv never overrides an
 * already-set variable, and the first file to define one wins, so precedence is:
 *
 *   exported env (CI / shell / direnv)  >  project root `.env`  >  legacy `.yt-briefing/.env`
 *
 * Root `.env` is the conventional, user-owned home for secrets (12-factor) — the tool only
 * *reads* it, never writes, so it can't clobber a user's other variables. `.yt-briefing/.env`
 * (written by the `init` wizard) stays a fallback so existing installs keep working.
 *
 * Call `loadEnv()` once at every entrypoint before reading any YT_BRIEFING_* variable.
 */
import dotenv from 'dotenv';
import { ROOT_ENV_PATH, ENV_PATH } from './paths.ts';

let done = false;

export function loadEnv(): void {
  if (done) return;
  done = true;
  dotenv.config({ path: ROOT_ENV_PATH });                            // primary: user-owned project root .env
  if (ENV_PATH !== ROOT_ENV_PATH) dotenv.config({ path: ENV_PATH }); // fallback: wizard's .yt-briefing/.env
}
