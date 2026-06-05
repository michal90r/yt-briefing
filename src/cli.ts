#!/usr/bin/env bun
/**
 * Thin CLI dispatcher so the tool is usable as `yt-briefing <cmd>` once installed,
 * mirroring the `bun run <script>` entry points. Each subcommand just forwards to the
 * matching engine script with the same runtime (bun/node), passing remaining args through.
 *
 *   yt-briefing init                       interactive onboarding wizard
 *   yt-briefing sweep [--reset]            advance one step; prints a JSON status line
 *   yt-briefing rate --rating 0|1 [...]    record a rating for the pending video
 *   yt-briefing transcribe <url|id>        print a single video's transcript
 */

import { spawnSync } from 'node:child_process';
import { script } from './lib/paths.ts';

const [cmd, ...rest] = process.argv.slice(2);

const TARGETS: Record<string, string> = {
  init: 'bootstrap.ts',
  sweep: 'yt-sweep.ts',
  rate: 'yt-rating.ts',
  transcribe: 'yt-transcript.ts',
};

if (!cmd || !TARGETS[cmd]) {
  console.error('Usage: yt-briefing <init|sweep|rate|transcribe> [args...]');
  process.exit(cmd ? 1 : 0);
}

const res = spawnSync(process.execPath, [script(TARGETS[cmd]!), ...rest], { stdio: 'inherit' });
process.exit(res.status ?? 1);
