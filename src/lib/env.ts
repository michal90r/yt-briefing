/**
 * Env loader + required-variable preflight — the one place that reads secrets off disk.
 *
 * Keys come from the project's root `.env` ONLY. There is no fallback file: dotenv loads root
 * `.env` into process.env (anything already exported wins, since dotenv never overrides). Missing
 * a required variable is a hard error that names exactly which one — never a silent default.
 *
 * Call `loadEnv()` once at every entrypoint, then `requireEnv([...])` for what that command needs.
 */
import dotenv from 'dotenv';
import { ROOT_ENV_PATH } from './paths.ts';

let done = false;

/** Load the project's root `.env` into process.env. The only file we read. */
export function loadEnv(): void {
  if (done) return;
  done = true;
  dotenv.config({ path: ROOT_ENV_PATH });
}

/** The required vars per capability — single source of truth for the preflight checks. */
export const REQUIRED_LLM = ['YT_BRIEFING_LLM_BASE_URL', 'YT_BRIEFING_LLM_API_KEY', 'YT_BRIEFING_LLM_MODEL'];
export const REQUIRED_YOUTUBE = ['YT_BRIEFING_YOUTUBE_API_KEY'];

/** Names from `names` that are missing or empty in the environment, in order. */
export function missingEnv(names: string[]): string[] {
  return names.filter(n => !process.env[n]);
}

/** Human-readable error for a set of missing vars — names each one and where to set it. */
export function missingEnvMessage(missing: string[]): string {
  const plural = missing.length > 1;
  return `Missing required environment variable${plural ? 's' : ''}: ${missing.join(', ')}. ` +
    `Set ${plural ? 'them' : 'it'} in your project root .env (see README → Setup).`;
}

/** Throw a clear, named error if any required var is missing. */
export function requireEnv(names: string[]): void {
  const missing = missingEnv(names);
  if (missing.length) throw new Error(missingEnvMessage(missing));
}
