#!/usr/bin/env node
/**
 * Usage: bun src/yt-ui.ts
 *
 * Prints where /yt should run, from `ui` in config.json: `pane` (default) or `chat`.
 * The Claude Code plugin calls this because it cannot read the project's data directory itself.
 */
import { loadConfig } from './lib/config.ts';

process.stdout.write(`${loadConfig().ui}\n`);
