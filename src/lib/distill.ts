/**
 * Turn a raw rating comment ("too much politics, skip these panels") into what the profile
 * stores: one clean, generalizable rule for `## Notes`, plus the rating it implies.
 *
 * This used to be the agent's job in the chat loop. With the rating loop in a pane there is no
 * agent turn per video, so the engine does it with the same `claude -p` call it uses everywhere.
 */
import { chat } from './llm.ts';

export interface Distilled {
  rating: 0 | 1;  // 0 = clearly negative about this video, 1 = otherwise
  rule: string;   // the rule as it goes into ## Notes
}

export function distillPrompt(comment: string, video: { channel: string; title: string; type: string }): string {
  return `A user rating videos from the YouTube channel ${video.channel} left this comment on the video "${video.title}" (${video.type}):

"""${comment}"""

Turn it into ONE durable rule for this channel's profile — a standing instruction the briefing tool will follow for future videos of this channel (what to skip, what to keep, how to summarize). Generalize from this one video to the pattern the user means; keep the user's intent, drop chit-chat. Write the rule in the same language as the comment, one or two sentences.

Also decide the rating for THIS video: 0 if the comment is clearly negative about it (worthless, noise, should have been skipped), otherwise 1.

Output ONLY raw JSON, no fences: {"rating":0|1,"rule":"..."}`;
}

/** Parse the model's answer; null when it isn't the JSON asked for. */
export function parseDistilled(out: string): Distilled | null {
  const start = out.indexOf('{'), end = out.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const d = JSON.parse(out.slice(start, end + 1)) as { rating?: unknown; rule?: unknown };
    const rule = typeof d.rule === 'string' ? d.rule.trim() : '';
    if (!rule || (d.rating !== 0 && d.rating !== 1)) return null;
    return { rating: d.rating, rule };
  } catch {
    return null;
  }
}

export async function distillComment(comment: string, video: { channel: string; title: string; type: string }): Promise<Distilled> {
  const out = await chat(distillPrompt(comment, video), {
    system: 'You turn user feedback into concise profile rules. Output only the JSON asked for.',
  });
  const d = parseDistilled(out);
  if (!d) throw new Error(`could not distill the comment: ${out.slice(0, 200)}`);
  return d;
}
