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
 * Did the user actually see the summary? The summary carries the video's watch URL, so its id
 * appears verbatim wherever it was shown. Two surfaces count:
 *
 * - the assistant's own text blocks (step B, the paste above the popup);
 * - the `AskUserQuestion` call itself — the popup's question text is what the user reads while
 *   rating, and some clients don't show chat text above an open popup at all.
 *
 * The popup is also the only surface that is reliably on disk in time: the harness can persist an
 * assistant's text blocks late — in background sessions only once the turn ends — while the
 * popup's tool_use entry is written as soon as the call is made. Gating on text alone blocked
 * ratings whose summary the user had plainly read (measured 2026-10-04: the popup entry carrying
 * the id was in the transcript, the text block with the same id was not, across several messages
 * of one turn). Other tool calls and all tool results still don't count — the user sees neither.
 */
export function summaryWasPasted(transcript: string, videoId: string): boolean {
  for (const line of transcript.split('\n')) {
    if (!line.includes(videoId)) continue;
    let entry: { message?: { role?: string; content?: ContentBlock[] } };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) continue;
    if (entry.message.content.some((b) => shownToUser(b, videoId))) return true;
  }
  return false;
}

type ContentBlock = { type?: string; text?: string; name?: string; input?: unknown };

function shownToUser(block: ContentBlock, videoId: string): boolean {
  if (block.type === 'text') return block.text?.includes(videoId) ?? false;
  if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
    return JSON.stringify(block.input ?? {}).includes(videoId);
  }
  return false;
}
