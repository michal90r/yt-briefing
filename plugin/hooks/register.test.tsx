import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// The engine is faked at `process.run`: the test's hooks sit beneath the plugin, so they answer
// for the yt-sweep / yt-rating subprocesses exactly as the CLI would.

const VIDEO = {
  status: 'rating_needed',
  summary: '### @chan — "A video"\n\n1. **Point.** Something said.',
  pending: { channel: '@chan', videoId: 'vid123', title: 'A video', type: 'longform', publishedAt: '2026-10-05T00:00:00Z' },
  lang: 'Polish',
  skipped: 1,
  skips: [{ channel: '@chan', title: 'A short', reason: 'short' }],
}

/** What the engine itself answers beneath the plugin: toasts, the session's prompt. */
function host(on: On, log: { submitted: string[]; toasts: string[] }) {
  on('ui.toast', async (_$, e) => { log.toasts.push(e.text); return { value: undefined } })
  on('ui.log', async (_$, e) => { log.toasts.push(e.text); return { value: undefined } })
  on('clock.after', async () => ({ value: undefined }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  on('prompt.submit', async (_$, e) => { log.submitted.push([e.text, ...(e.context ?? [])].join('\n')); return { text: e.text } })
}
/** A finished engine subprocess, as `$.process.run` resolves it. */
const ran = (stdout: string, exitCode = 0, stderr = '') =>
  ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** `/yt` as the person typing it. */
const YT = { command: 'yt' } as never

/** A prompt.compose input as the engine raises it. */
const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [] } as never

const newLog = () => ({ submitted: [] as string[], toasts: [] as string[] })

test('/yt runs in the chat: each briefing is a chat turn and the rating dialog follows it', async ($, on) => {
  const calls: string[][] = []
  const asked: string[] = []
  const log = newLog()
  host(on, log)
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    if (e.argv.some(a => a.includes('yt-sweep'))) return ran(JSON.stringify(VIDEO))
    return ran('{"ok":true}')
  })
  // The first answer comes at once, as a second tap on the dialog before would: it must be ignored.
  const answers: [string, number][] = [['Weak', 0], ['OK', 1600]]
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const { questions } = e as unknown as { questions: { question: string }[] }
    const q = questions[0].question
    asked.push(q)
    const [answer, wait] = answers.shift() ?? ['Stop', 0]
    await new Promise(r => setTimeout(r, wait))
    return { result: { questions, answers: { [q]: answer } } } as never
  })
  const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise(r => setTimeout(r, 30)) }

  const out = await $.command.run(YT)
  expect(out.text).toContain('runs in the chat')
  await until(() => log.submitted.length > 0)
  expect(log.submitted).toEqual(['yt: next video'])
  const loop = async () => (await $.prompt.compose(COMPOSE)).sections.find(x => x.id === 'yt-briefing:loop')?.text ?? ''
  expect(await loop()).toMatch(/yt-sweep\S* --reset/)
  expect(await loop()).toContain('verbatim')
  expect(asked).toEqual([])

  await $.turn.complete({ answer: 'the summary', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await until(() => log.submitted.length > 1)

  expect(asked).toEqual(['«A video» — rating?', '«A video» — rating?'])
  const ratings = calls.filter(c => c.some(a => a.includes('yt-rating')))
  expect(ratings).toHaveLength(1)
  expect(ratings[0]).toEqual(expect.arrayContaining(['--rating', '1']))
  expect(log.submitted[1]).toBe('yt: next video')
  expect(await loop()).toMatch(/yt-sweep\S*`/)
  expect(await loop()).not.toContain('--reset')
})
