import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pending, View } from '../types'
import { engine } from './engine.ts'

// The /yt rating loop as a pane. Every step runs the engine as a subprocess and reads its one-line
// JSON; the model is not involved unless the person asks for research, which hands the video to
// the session as a prompt. Ratings and comments are written by the engine, never by this module.
// Where no pane can be seen (a Remote Control web client, a surface that places none) the same
// loop runs in the engine's own question dialog instead.

const PANE = 'yt-briefing'
const view = atom({ plugin: 'yt-briefing', key: 'view' } as const, { phase: 'idle' } as View)

/** A sweep can expand channels, fetch transcripts and summarize; give it the engine's full budget. */
const SWEEP_MS = 10 * 60_000
/** A rating is a file write; a raw comment adds one `claude -p` call to distill it. */
const RATE_MS = 3 * 60_000

type Skip = { channel: string; title: string; reason: string }
type SweepOut = {
  status: string
  summary?: string
  pending?: Pending
  lang?: string
  error?: string
  skipped?: number
  skips?: Skip[]
}

const STATUS_TEXT: Record<string, string> = {
  done: 'Sweep finished: nothing left to rate.',
  rate_limited: 'YouTube is blocking this IP (429 / captcha). See README → Proxy.',
  tooling_error: 'Transcript tooling failed (proxy, yt-dlp or network). See README → Proxy.',
}

/** The engine prints one JSON line on stdout; take the last non-empty line to be safe. */
function parseOut(stdout: string): SweepOut {
  const line = stdout.trim().split('\n').filter(Boolean).pop() ?? ''
  return JSON.parse(line) as SweepOut
}

/** Replace the whole view; the one writer for a fresh phase. */
async function setView($: EngineInterface, next: View) {
  await update($, view, () => next)
}

function skipLine(out: SweepOut): string | undefined {
  if (!out.skipped || !out.skips?.length) return undefined
  const list = out.skips.map(s => `${s.channel} «${s.title}» — ${s.reason}`).join('; ')
  return `Skipped ${out.skipped}: ${list}`
}

/** One engine sweep: the next ratable video, or the end state. Throws when the engine does not answer. */
async function runSweep($: EngineInterface, reset: boolean): Promise<SweepOut> {
  const run = await $.process.run([...engine('yt-sweep'), ...(reset ? ['--reset'] : [])], { timeoutMs: SWEEP_MS })
  return parseOut(run.stdout)
}

/** What a sweep that found nothing to rate says, skips included. */
function endText(out: SweepOut): string {
  const text = out.status === 'done' ? STATUS_TEXT.done : out.error ?? STATUS_TEXT[out.status] ?? `Engine status: ${out.status}`
  const skipped = skipLine(out)
  return skipped ? `${text}\n${skipped}` : text
}

/** Advance to the next ratable video and put it (or the end state) in the view. */
async function sweep($: EngineInterface, reset: boolean) {
  await setView($, { phase: 'loading' })
  let out: SweepOut
  try {
    out = await runSweep($, reset)
  } catch (err) {
    await setView($, { phase: 'error', message: `The engine did not answer: ${String(err)}` })
    return
  }
  const skipped = skipLine(out)
  if (out.status === 'rating_needed' && out.summary && out.pending) {
    await setView($, { phase: 'rating', summary: out.summary, pending: out.pending, lang: out.lang, skipped })
  } else if (out.status === 'done') {
    await setView($, { phase: 'done', message: STATUS_TEXT.done, skipped })
  } else {
    await setView($, { phase: 'error', message: out.error ?? STATUS_TEXT[out.status] ?? `Engine status: ${out.status}`, skipped })
  }
}

/** Record a rating (engine args), then move on; on failure stay on the video and say why. */
async function rate($: EngineInterface, args: string[], thenNext = true): Promise<{ rule?: string } | null> {
  const v = await read($, view)
  if (v.phase !== 'rating' || v.busy) return null
  await update($, view, cur => ({ ...cur, busy: args[0] === '--raw-comment' ? 'Turning the comment into a rule…' : 'Saving…' }))
  const result = await record($, args)
  if (!result) {
    await update($, view, cur => ({ ...cur, busy: undefined }))
    return null
  }
  if (thenNext) void sweep($, false)
  return result
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

/** Research: mark the video seen, close the pane and hand the video to the session. */
async function research($: EngineInterface, question?: string) {
  const v = await read($, view)
  if (!v.pending || !v.summary) return
  if (!(await rate($, ['--rating', '1'], false))) return
  await $.ui.close({ id: PANE })
  await handOff($, v.pending, v.summary, v.lang, question)
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

async function comment($: EngineInterface, raw: string) {
  const text = raw.trim()
  if (!text) return
  if (text.toLowerCase() === 'stop') return void $.ui.close({ id: PANE })
  if (text.startsWith('?')) return research($, text.slice(1).trim() || undefined)
  const saved = await rate($, ['--raw-comment', text])
  if (saved?.rule) $.ui.toast(`Rule saved: ${saved.rule}`)
}

/** True when the person typed /yt through Remote Control and nothing attached can show a pane. */
async function paneUnseen($: EngineInterface, origin: { kind: string } | undefined): Promise<boolean> {
  if (origin?.kind !== 'bridge') return false
  return !(await $.session.surfaces()).some(s => s !== 'terminal')
}

// Where no pane can be seen the loop runs in the chat. A phone or web client draws a plugin's
// command output and its dialogs, but not its log lines, and it folds text written mid-turn into a
// one-line digest; only a turn's last message shows whole. So each briefing is the model's whole
// answer to a prompt this plugin submits, and the rating dialog opens once that turn has ended.

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
    out = await runSweep($, false)
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
      description: 'Rate the next videos from the YouTube channels you follow, in a pane',
    })

    return next(e)
  })

  on('command.run', { command: 'yt' }, async ($, e) => {
    if (!(await paneUnseen($, e.origin))) {
      const opened = await $.ui.open({ id: PANE, title: 'yt-briefing', focus: true, closeOnEscape: true })
      if (opened.isPlaced) {
        void sweep($, true)
        return { text: 'Briefing opened in a pane.' }
      }
      await $.ui.close({ id: PANE })
    }
    looping = true
    submitLater($, true)

    return { text: 'No pane here: the briefing runs in the chat.' }
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const v = await read($, view)
    const close = () => void $.ui.close({ id: PANE })

    if (v.phase === 'idle' || v.phase === 'loading') {
      return <Text dimColor>Finding the next video…</Text>
    }

    if (v.phase !== 'rating') {
      return (
        <Box flexDirection="column">
          {v.skipped && <Text dimColor>{v.skipped}</Text>}
          <Text>{v.message ?? ''}</Text>
          <Button key="close" label="Close" hotkey="c" role="dismiss" onPress={close} />
        </Box>
      )
    }

    const idle = !v.busy
    const buttons = (
      <Box flexDirection="row" gap={2}>
        <Button key="ok" label="OK" hotkey="1" variant="primary" dimColor={!idle}
          onPress={() => void rate($, ['--rating', '1'])} />
        <Button key="weak" label="Weak" hotkey="2" dimColor={!idle}
          onPress={() => void rate($, ['--rating', '0'])} />
        <Button key="research" label="Research" hotkey="3" dimColor={!idle}
          onPress={() => void research($)} />
        <Button key="stop" label="Stop" hotkey="4" role="dismiss" onPress={close} />
      </Box>
    )

    let field = null
    if (e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      field = (
        <Input key="comment" label="Comment" submitLabel="save rule"
          placeholder="becomes a rule for this channel · ?question = research · stop"
          onSubmit={value => void comment($, value)} />
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {v.skipped && <Text dimColor>{v.skipped}</Text>}
        <Markdown text={(v.summary ?? '').slice(0, 10000)} />
        {v.busy ? <Text dimColor>{v.busy}</Text> : buttons}
        {field}
        <Text dimColor>OK = neutral · Weak = teach the filter to skip titles like this · Research = dig into it with Claude</Text>
      </Box>
    )
  })
}
