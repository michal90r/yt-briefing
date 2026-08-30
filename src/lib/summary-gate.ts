/**
 * Decision logic for the /yt summary gate — kept separate from the hook script so it is
 * runtime-agnostic and unit-testable: pure functions over a payload and a transcript.
 *
 * See `src/yt-summary-gate.ts` for why the gate exists and how the hook wires it up.
 */

/** Shape of the bits of Claude Code's PreToolUse payload the gate looks at. */
export type GatePayload = {
  tool_name?: string;
  transcript_path?: string;
  cwd?: string;
  tool_input?: { questions?: { options?: { label?: string }[] }[] };
};

/**
 * Is this the /yt rating popup? Identified by its fixed option labels, which SKILL.md pins in
 * English across every `output_lang` (only the question text and descriptions are localised).
 * Anything else — including /yt-search's keep/skip — is none of the gate's business.
 */
export function isRatingPopup(payload: GatePayload): boolean {
  const labels = (payload.tool_input?.questions ?? [])
    .flatMap((q) => q.options ?? [])
    .map((o) => (o.label ?? '').trim().toLowerCase());
  return labels.includes('research') && labels.includes('weak');
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
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.message?.role !== 'assistant' || !Array.isArray(entry.message.content)) continue;
    if (entry.message.content.some((b) => b.type === 'text' && b.text?.includes(videoId))) return true;
  }
  return false;
}

/**
 * Same question as `summaryWasPasted`, but tolerant of the harness writing the transcript late.
 *
 * The agent pastes the summary and calls the popup in one turn, so the text block and the tool
 * call are separate JSONL entries written by the harness asynchronously — the hook can run
 * while only the tool call has reached disk. A single read then reports "not pasted" for a turn
 * that did paste, and the block fires on every single video (observed 2026-08-30: the same
 * transcript and pending file that blocked, replayed seconds later, allowed).
 *
 * So poll instead of guessing: re-read until the id shows up or the window closes. A turn that
 * genuinely skipped the paste never produces the line, so the gate still blocks — just later.
 * `read` returning null (a torn read mid-write) counts as "not yet", not as proof of absence.
 */
export async function waitForSummary(
  read: () => string | null,
  videoId: string,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 200;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;

  for (;;) {
    const transcript = read();
    if (transcript !== null && summaryWasPasted(transcript, videoId)) return true;
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
