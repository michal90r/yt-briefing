#!/usr/bin/env node
/**
 * yt-summary-gate — PreToolUse gate for Claude Code: refuses the /yt rating popup until the
 * video's summary has actually been pasted into the chat.
 *
 * Step B of the rating loop (paste `out.summary` verbatim, THEN ask) is the one instruction the
 * agent can drop with no visible symptom: the popup still appears, the user still answers, and
 * the rating is recorded against a summary nobody saw. Observed failure mode — the paste happens
 * reliably while the sweep also returns a `skipped` list (there is other prose to write) and gets
 * dropped in iterations that return none, where the turn can open straight with a tool call. A
 * blind rating is worse than no rating: it teaches the title filter from noise.
 *
 * The engine cannot enforce this — `yt-sweep` only emits the summary, `yt-rating` only reads
 * `pending.json`, and neither can see the conversation. The transcript is the one place the
 * evidence exists and only the agent harness exposes it, so the check has to run as a hook.
 *
 * The transcript is polled for a few seconds rather than read once: the paste and the popup are
 * a single turn and the harness flushes the JSONL asynchronously, so a single read can miss a
 * text block that is merely still in flight.
 *
 * Reads the PreToolUse payload on stdin; exit 0 allows, exit 2 blocks and feeds stderr back to
 * the agent. Anything unexpected — foreign tool, unreadable transcript, no pending video —
 * allows: a gate that misfires on unrelated work would be worse than the bug it guards.
 */
import { readFileSync, existsSync } from 'node:fs';
import { isRatingPopup, waitForSummary, type GatePayload } from './lib/summary-gate.ts';

const ALLOW = 0;
const BLOCK = 2;
const allow = (): never => process.exit(ALLOW);

let payload: GatePayload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8')) as GatePayload;
} catch {
  allow();
}

if (payload!.tool_name !== 'AskUserQuestion' || !isRatingPopup(payload!)) allow();

// paths.ts derives the data dir from the cwd, which for a hook is the agent's, not ours — so the
// import has to wait until we've moved there.
if (payload!.cwd && existsSync(payload!.cwd)) process.chdir(payload!.cwd);
const { PENDING_FILE } = await import('./lib/paths.ts');

let pending: { videoId?: string; title?: string } = {};
try {
  pending = JSON.parse(readFileSync(PENDING_FILE, 'utf8')) as typeof pending;
} catch {
  allow(); // no pending video (or unreadable) — nothing to gate on
}
if (!pending.videoId) allow();

const transcript = payload!.transcript_path;
if (!transcript || !existsSync(transcript)) allow();

// Poll rather than read once: the paste and this popup are one turn, and the harness writes the
// transcript asynchronously, so the text block can still be in flight while the hook runs.
const seen = await waitForSummary(() => {
  try {
    return readFileSync(transcript!, 'utf8');
  } catch {
    return null; // transient (file being written) — treat as "not yet", keep waiting
  }
}, pending.videoId!);
if (seen) allow();

process.stderr.write(
  `/yt step B not done: the summary for ${pending.videoId} ("${pending.title ?? '?'}") is not in your chat text.\n` +
    `Paste out.summary verbatim as your reply first, then ask for the rating — the user rates what they can see.\n`,
);
process.exit(BLOCK);
