#!/usr/bin/env node
/**
 * Thin CLI dispatcher so the tool is usable as `yt-briefing <cmd>` once installed,
 * mirroring the `bun run <script>` entry points. Each subcommand just forwards to the
 * matching engine script with the same runtime as this process (`process.execPath` — Node
 * or Bun), passing remaining args through.
 *
 *   yt-briefing init                       interactive onboarding wizard
 *   yt-briefing install-skill              install the /yt skill into a coding agent
 *   yt-briefing add|remove <@handle|url>   add or remove channels (also list)
 *   yt-briefing list                       list the channels you follow
 *   yt-briefing sweep [--reset]            advance one step; prints a JSON status line
 *   yt-briefing rate --rating 0|1 [...]    record a rating for the pending video
 *   yt-briefing transcribe <url|id>        print a single video's transcript
 *   yt-briefing search "<intent>" --channel <@handle|url>   search within one channel → triage → compare
 */

import { spawnSync } from 'node:child_process';
import { script } from './lib/paths.ts';

const [cmd, ...rest] = process.argv.slice(2);

// Subcommand → engine script. Channel actions all route to yt-channels with the action
// passed through as its first arg.
const TARGETS: Record<string, string> = {
  init: 'bootstrap',
  'install-skill': 'install-skill',
  sweep: 'yt-sweep',
  rate: 'yt-rating',
  transcribe: 'yt-transcript',
  search: 'yt-search',
};
const CHANNEL_ACTIONS = new Set(['add', 'remove', 'list']);

let argv: string[] | null = null;
if (cmd && CHANNEL_ACTIONS.has(cmd)) argv = [script('yt-channels'), cmd, ...rest];
else if (cmd && TARGETS[cmd]) argv = [script(TARGETS[cmd]!), ...rest];

if (!argv) {
  console.error('Usage: yt-briefing <init|install-skill|add|remove|list|sweep|rate|transcribe|search> [args...]');
  process.exit(cmd ? 1 : 0);
}

const res = spawnSync(process.execPath, argv, { stdio: 'inherit' });
process.exit(res.status ?? 1);
