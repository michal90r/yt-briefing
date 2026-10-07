/**
 * User preferences for yt-briefing — the output language (decided at onboarding) and an optional
 * after-rate command, stored in DATA_DIR/config.json. Kept separate from .env on purpose:
 * .env holds secrets (API keys, proxy), config.json holds non-secret preferences that
 * the engine reads. `output_lang` is the language summaries are written in; `after_rate` is a shell
 * command run (detached, from the project root) after every recorded rating, e.g. a script that
 * commits DATA_DIR to git. The engine itself never runs VCS; the command is yours. `ui` is `"chat"`
 * to run /yt in the chat (summary as a message, rating dialog) instead of a side pane.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CONFIG_JSON } from './paths.ts';

export interface Config {
  output_lang: string;   // natural-language name, e.g. "English", "Polish", "Spanish"
  after_rate?: string;   // shell command run after each rating (optional)
  ui: 'pane' | 'chat';   // where /yt runs: a side pane (default) or the chat itself
}

export function loadConfig(): Config {
  let c: Record<string, unknown> = {};
  if (existsSync(CONFIG_JSON)) {
    try { c = JSON.parse(readFileSync(CONFIG_JSON, 'utf8')); } catch { /* malformed → defaults */ }
  }
  const lang = typeof c.output_lang === 'string' && c.output_lang.trim()
    ? c.output_lang.trim()
    : process.env.OUTPUT_LANG?.trim() || 'English';
  const afterRate = typeof c.after_rate === 'string' && c.after_rate.trim() ? c.after_rate.trim() : undefined;
  const ui = c.ui === 'chat' ? 'chat' : 'pane';
  return { output_lang: lang, ui, ...(afterRate ? { after_rate: afterRate } : {}) };
}

/** The language summaries and ratings are written in. Default English. */
export const outputLang = (): string => loadConfig().output_lang;
