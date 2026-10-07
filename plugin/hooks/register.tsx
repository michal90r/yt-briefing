import type { EngineInterface, Register } from 'claude-code'

import type { Pending } from '../types'
import { engine } from './engine.ts'

// The /yt rating loop, in the chat on every surface. Each briefing is the model's whole answer to a
// prompt this plugin submits, so the summary shows in full in the terminal, the desktop app and on
// a phone; the rating dialog opens once that turn has ended. Ratings and comments are written by
// the engine, never by this module.

/** A sweep can expand channels, fetch transcripts and summarize; give it the engine's full budget. */
const SWEEP_MS = 10 * 60_000
/** A rating is a file write; a raw comment adds one `claude -p` call to distill it. */
const RATE_MS = 3 * 60_000

type SweepOut = {
  status: string
  summary?: string
  pending?: Pending
  lang?: string
}

/** The engine prints one JSON line on stdout; take the last non-empty line to be safe. */
function parseOut(stdout: string): SweepOut {
  const line = stdout.trim().split('\n').filter(Boolean).pop() ?? ''
  return JSON.parse(line) as SweepOut
}

/** One engine sweep: the next ratable video, or the end state. Throws when the engine does not answer. */
async function runSweep($: EngineInterface): Promise<SweepOut> {
  const run = await $.process.run(engine('yt-sweep'), { timeoutMs: SWEEP_MS })
  return parseOut(run.stdout)
}

/** Run the rating engine; on failure toast why and resolve null. */
async function record($: EngineInterface, args: string[]): Promise<{ rule?: string } | null> {
  const run = await $.process.run([...engine('yt-rating'), ...args], { timeoutMs: RATE_MS }).catch(err => ({
    exitCode: 1, stdout: '', stderr: String(err),
  }))
  if (run.exitCode !== 0) {
    $.ui.toast(`Rating not saved: ${run.stderr.trim().slice(0, 200) || 'engine error'}`)
    return null
  }
  let result: { rule?: string } = {}
  try { result = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}') } catch { /* rating is on disk */ }
  return result
}

/** Give the video to the session as the person's prompt, to research it together. */
async function handOff($: EngineInterface, p: Pending, summary: string, lang: string | undefined, question?: string) {
  const transcript = [...engine('yt-transcript'), p.videoId, '--lang', 'auto'].join(' ')
  const ask = question
    ? `My question: ${question}`
    : 'Ask me first what I want to dig into.'
  await $.prompt.submit({
    asUser: true,
    text: [
      `Let's research this video together: ${p.channel} — "${p.title}" (${p.videoId}, ${p.type}).`,
      '',
      'Its briefing:',
      summary,
      '',
      `For anything beyond the briefing, pull the full transcript with \`${transcript}\` and work from the tool result; never paste the transcript into the chat, quote only short passages. Keep what the video claims separate from what you verify yourself, and use whatever the question needs (my project, the web). Answer in ${lang ?? 'English'}.`,
      ask,
      '',
      'If it turns out to be hype, record it with `' + [...engine('yt-rating'), '--rating', '0'].join(' ') + '`; a lasting preference about this channel goes in with `' + [...engine('yt-rating'), '--raw-comment', '"<what to remember>"'].join(' ') + '`.',
    ].join('\n'),
  }).catch(err => $.ui.toast(`Could not hand the video to the session: ${String(err)}`))
}

// A phone or web client draws a plugin's command output and its dialogs, but not its log lines,
// and it folds text written mid-turn into a one-line digest; only a turn's last message shows whole.

/** True while the chat loop runs; a prompt the person types ends it. */
let looping = false

/** An answer this soon after its dialog opened is a tap meant for the dialog before it. */
const STRAY_TAP_MS = 1500

const CHOICES = ['OK', 'Weak', 'Research', 'Stop'] as const

/** What a briefing turn must do, read from the system prompt while the loop runs. */
function loopSection(reset: boolean): string {
  const sweep = [...engine('yt-sweep'), ...(reset ? ['--reset'] : [])].join(' ')
  return [
    `The yt-briefing plugin is running the person's YouTube briefing. A user message reading exactly "${NEXT_TEXT}" is its request for the next video:`,
    `run \`${sweep}\`; it prints one JSON line. If \`status\` is \`rating_needed\`, answer with \`summary\` verbatim as your whole message, Markdown kept: nothing before or after it, no question, no tool call after it (the plugin opens the rating dialog itself).`,
    'Otherwise answer with one short line saying why there is nothing to rate. Write in the language of the summaries.',
  ].join('\n')
}

/** What the chat shows of each briefing prompt; the instructions ride along as unseen context. */
const NEXT_TEXT = 'yt: next video'

/** Whether the next briefing prompt starts a fresh sweep. */
let resetNext = false

/** Ask for a briefing once the hook that wants it has answered: one submitted from inside would wait on it. */
function submitLater($: EngineInterface, reset: boolean) {
  resetNext = reset
  $.clock.after(0, () => void $.prompt.submit({ text: NEXT_TEXT, asUser: true }).catch(err => {
    looping = false
    $.ui.toast(`Could not continue the briefing: ${String(err)}`)
  }))
}

/** After a briefing turn: ask for the rating, record it and fetch the next one. */
async function rateAfterTurn($: EngineInterface) {
  let out: SweepOut
  try {
    out = await runSweep($)
  } catch {
    looping = false
    return
  }
  if (out.status !== 'rating_needed' || !out.pending || !out.summary) {
    looping = false
    return
  }
  const title = out.pending.title.length > 80 ? `${out.pending.title.slice(0, 79)}…` : out.pending.title
  let answer: string
  for (;;) {
    const opened = Date.now()
    try {
      answer = (await $.ui.ask(`«${title}» — rating?`, { header: 'yt-briefing', options: CHOICES })).trim()
    } catch {
      looping = false
      return
    }
    if (!looping) return
    if (Date.now() - opened >= STRAY_TAP_MS) break
  }

  if (answer === 'Stop' || answer.toLowerCase() === 'stop' || !answer) {
    looping = false
    return
  }
  if (answer === 'Research' || answer.startsWith('?')) {
    looping = false
    if (!(await record($, ['--rating', '1']))) return
    const q = answer.startsWith('?') ? answer.slice(1).trim() || undefined : undefined
    return handOff($, out.pending, out.summary, out.lang, q)
  }
  const args = answer === 'OK' ? ['--rating', '1'] : answer === 'Weak' ? ['--rating', '0'] : ['--raw-comment', answer]
  if (!(await record($, args))) {
    looping = false
    return
  }
  submitLater($, false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'yt',
      description: 'Rate the next videos from the YouTube channels you follow',
    })

    return next(e)
  })

  on('command.run', { command: 'yt' }, async ($) => {
    looping = true
    submitLater($, true)

    return { text: 'The briefing runs in the chat.' }
  })

  // The engine shows a plugin none of its own prompts, so a prompt seen here is the person's.
  on('prompt.submit', async ($, e, next) => {
    if (looping && e.origin?.kind !== 'plugin') looping = false
    return next(e)
  })

  // The loop's instructions ride in the system prompt, so the chat shows only NEXT_TEXT.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!looping) return composed
    return { sections: [...composed.sections, { id: 'yt-briefing:loop', text: loopSection(resetNext), scope: 'session' as const }] }
  })

  on('turn.complete', async ($, e, next) => {
    if (looping && !e.agentId && e.reason === 'answer') void rateAfterTurn($)
    return next(e)
  })
}
