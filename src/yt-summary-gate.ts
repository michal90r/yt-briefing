#!/usr/bin/env node
/**
 * yt-summary-gate — PreToolUse gate for Claude Code: refuses to RECORD a rating until the
 * video's summary has actually been pasted into the chat.
 *
 * Step B of the rating loop (paste `out.summary` verbatim, THEN ask) is the one instruction the
 * agent can drop with no visible symptom: the popup still appears, the user still answers, and
 * the rating is recorded against a summary nobody saw. A blind rating is worse than no rating:
 * it teaches the title filter from noise.
 *
 * WHY IT GATES THE WRITE AND NOT THE POPUP. Until 0.15.0 this hook ran on `AskUserQuestion` and
 * blocked the popup. That could never work: the harness writes an assistant message's entries to
 * the transcript only once the message is COMPLETE — i.e. after its tool calls have returned —
 * and the skill pastes the summary and opens the popup in a single message. So the gate asked
 * the transcript for text that could not be there yet, and the write it was waiting on could not
 * happen until the gate returned. It blocked every video and cleared on a blind retry (measured
 * 2026-08-30: a marker in a long text block was absent from the transcript during its own
 * message's tool call, and present in the next message immediately). 0.14.2's 5s poll treated
 * that as a timing lag and so only made the block slower.
 *
 * The rating write is a separate Bash call in the FOLLOWING message, by which point the message
 * carrying the summary is closed and on disk — the evidence exists exactly when this hook needs
 * it. The tradeoff is honest: a genuinely skipped paste is now caught after the user has already
 * answered the popup, so that one answer is wasted and the agent has to paste and re-ask. That
 * costs nothing on the happy path, and it guards the thing that actually matters — what gets
 * written into the channel profile.
 *
 * Reads the PreToolUse payload on stdin; exit 0 allows, exit 2 blocks and feeds stderr back to
 * the agent. Anything unexpected — foreign tool, unreadable transcript, no pending video —
 * allows: a gate that misfires on unrelated work would be worse than the bug it guards. This
 * hook is matched on Bash, so it runs on ordinary shell work too: it must decide from the
 * command string and exit before touching the disk.
 */
import { readFileSync, existsSync } from 'node:fs';
import { isRatingWrite, summaryWasPasted, type GatePayload } from './lib/summary-gate.ts';

const ALLOW = 0;
const BLOCK = 2;
const allow = (): never => process.exit(ALLOW);

let payload: GatePayload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8')) as GatePayload;
} catch {
  allow();
}

if (!isRatingWrite(payload!)) allow();

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

let seen = false;
try {
  seen = summaryWasPasted(readFileSync(transcript!, 'utf8'), pending.videoId!);
} catch {
  allow();
}
if (seen) allow();

process.stderr.write(
  `/yt step B not done: the summary for ${pending.videoId} ("${pending.title ?? '?'}") never appeared in your chat text, ` +
    `so this rating would be recorded against a summary the user never saw.\n` +
    `Paste out.summary verbatim as your reply, ask for the rating again, then record it.\n`,
);
process.exit(BLOCK);
