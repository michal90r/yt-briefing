/**
 * User preferences for yt-briefing — currently just the output language, decided at
 * onboarding and stored in DATA_DIR/config.json. Kept separate from .env on purpose:
 * .env holds secrets (API keys, proxy), config.json holds non-secret preferences that
 * both the engine and the agent (skill) read. The skill reads `output_lang` to ask the
 * rating question in the user's language; the engine reads it to write summaries in it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG_JSON } from './paths.ts';

export interface Config {
  output_lang: string;   // natural-language name, e.g. "English", "Polish", "Spanish"
}

export function loadConfig(): Config {
  if (existsSync(CONFIG_JSON)) {
    try {
      const c = JSON.parse(readFileSync(CONFIG_JSON, 'utf8'));
      if (typeof c.output_lang === 'string' && c.output_lang.trim()) {
        return { output_lang: c.output_lang.trim() };
      }
    } catch { /* malformed → fall through to env/default */ }
  }
  return { output_lang: process.env.OUTPUT_LANG?.trim() || 'English' };
}

/** The language summaries and ratings are written in. Default English. */
export const outputLang = (): string => loadConfig().output_lang;
