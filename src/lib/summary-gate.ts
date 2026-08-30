/**
 * Decision logic for the /yt summary gate — kept separate from the hook script so it is
 * runtime-agnostic and unit-testable: pure functions over a payload and a transcript.
 *
 * See `src/yt-summary-gate.ts` for why the gate exists and where it had to move to work at all.
 */

export type GatePayload = {
  tool_name?: string;
  tool_input?: { command?: string };
  cwd?: string;
  transcript_path?: string;
};

/** Substring identifying the rating writer; the skill always invokes it by this script name. */
const RATING_SCRIPT = 'yt-rating';

/**
 * Is this the call that writes a rating? The skill records every rating by running
 * `yt-rating(.ts|.js) --rating <1|0>` through Bash, so the command line is the signal. Anything
 * else — a sweep, a transcript pull, unrelated shell work — is none of the gate's business, and
 * is waved through before this module does any I/O at all.
 */
export function isRatingWrite(payload: GatePayload): boolean {
  if (payload.tool_name !== 'Bash') return false;
  const command = payload.tool_input?.command ?? '';
  return command.includes(RATING_SCRIPT) && command.includes('--rating');
}

/**
 * Did the agent actually paste the summary? The summary carries the video's watch URL, so its id
 * appears verbatim in the pasted text. Only the assistant's own text blocks count: the id also
 * travels through tool calls and their results, and neither is shown to the user.
 */
export function summaryWasPasted(transcript: string, videoId: string): boolean {
  for (const line of transcript.split('\n')) {
    if (!line.includes(videoId)) continue;
    let entry: { message?: { role?: string; content?: { type?: string; text?: string }[] } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) continue;
    if (entry.message.content.some((b) => b.type === 'text' && b.text?.includes(videoId))) return true;
  }
  return false;
}
