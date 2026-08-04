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
