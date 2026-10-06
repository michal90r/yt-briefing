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

const PANE_PROPS = { title: 'yt-briefing', isFocused: true, bodyColumns: 100, placement: 'inline' }

/** What the engine itself answers beneath the plugin: the pane, toasts, the session's prompt. */
function host(on: On, log: { submitted: string[]; toasts: string[]; closed: number }, placed = true) {
  on('ui.open', async () => ({ value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no surface places panes' } }))
  on('ui.close', async () => { log.closed += 1; return { value: undefined } })
  on('ui.toast', async (_$, e) => { log.toasts.push(e.text); return { value: undefined } })
  on('ui.log', async (_$, e) => { log.toasts.push(e.text); return { value: undefined } })
  on('clock.after', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => { log.submitted.push(e.text); return { text: e.text } })
}
/** A finished engine subprocess, as `$.process.run` resolves it. */
const ran = (stdout: string, exitCode = 0, stderr = '') =>
  ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/** `/yt` as the person typing it. */
const YT = { command: 'yt' } as never

const newLog = () => ({ submitted: [] as string[], toasts: [] as string[], closed: 0 })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: /yt shows the summary, OK records a neutral rating and advances`, async ($, on) => {
    const calls: string[][] = []
    let sweeps = 0
    host(on, newLog())
    on('process.run', async (_$, e) => {
      calls.push([...e.argv])
      if (e.argv.some(a => a.includes('yt-sweep'))) {
        sweeps += 1
        const out = sweeps === 1 ? VIDEO : { status: 'done' }
        return ran(JSON.stringify(out) + '\n')
      }
      return ran('{"ok":true}\n')
    })

    await $.command.run(YT)
    const ui = await $.ui.mount({
      plugin: 'yt-briefing', surface, component: 'Pane', requestId: 'yt-briefing', props: PANE_PROPS as never,
    })

    expect(calls[0]).toContain('--reset')
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Something said')
    expect((await ui.find({ text: 'Skipped 1' }))?.text).toContain('@chan «A short» — short')

    await ui.press({ key: 'ok' })

    const rating = calls.find(c => c.some(a => a.includes('yt-rating')))
    expect(rating).toEqual(expect.arrayContaining(['--rating', '1']))
    expect(calls.filter(c => c.some(a => a.includes('yt-sweep')))).toHaveLength(2)
    expect((await ui.find({ text: 'Sweep finished' }))?.text).toContain('nothing left to rate')
  })
}

test('Weak records rating 0; a typed comment goes to the engine raw', async ($, on) => {
  const calls: string[][] = []
  const log = newLog()
  host(on, log)
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    if (e.argv.some(a => a.includes('yt-sweep'))) return ran(JSON.stringify(VIDEO))
    return ran('{"ok":true,"rule":"Skip panels."}')
  })

  await $.command.run(YT)
  const ui = await $.ui.mount({
    plugin: 'yt-briefing', surface: 'terminal', component: 'Pane', requestId: 'yt-briefing', props: PANE_PROPS as never,
  })

  await ui.press({ key: 'weak' })
  expect(calls.find(c => c.some(a => a.includes('yt-rating')))).toEqual(expect.arrayContaining(['--rating', '0']))

  await ui.input({ key: 'comment', text: 'too many panels' })
  const raw = calls.filter(c => c.some(a => a.includes('yt-rating'))).pop()
  expect(raw).toEqual(expect.arrayContaining(['--raw-comment', 'too many panels']))
  expect(log.toasts.join()).toContain('Skip panels.')
})

test('Research marks the video seen, closes the pane and hands it to the session', async ($, on) => {
  const calls: string[][] = []
  const log = newLog()
  host(on, log)
  on('process.run', async (_$, e) => {
    calls.push([...e.argv])
    if (e.argv.some(a => a.includes('yt-sweep'))) return ran(JSON.stringify(VIDEO))
    return ran('{"ok":true}')
  })

  await $.command.run(YT)
  const ui = await $.ui.mount({
    plugin: 'yt-briefing', surface: 'terminal', component: 'Pane', requestId: 'yt-briefing', props: PANE_PROPS as never,
  })
  await ui.input({ key: 'comment', text: '?does this beat our setup' })

  expect(calls.find(c => c.some(a => a.includes('yt-rating')))).toEqual(expect.arrayContaining(['--rating', '1']))
  expect(calls.filter(c => c.some(a => a.includes('yt-sweep')))).toHaveLength(1)
  expect(log.closed).toBe(1)
  expect(log.submitted[0]).toContain('vid123')
  expect(log.submitted[0]).toContain('My question: does this beat our setup')
  expect(log.submitted[0]).toContain('Answer in Polish')
  expect(log.toasts).toEqual([])
})

test('a failed rating stays on the video', async ($, on) => {
  host(on, newLog())
  on('process.run', async (_$, e) => {
    if (e.argv.some(a => a.includes('yt-sweep'))) return ran(JSON.stringify(VIDEO))
    return ran('', 1, 'Channel @chan not found')
  })

  await $.command.run(YT)
  const ui = await $.ui.mount({
    plugin: 'yt-briefing', surface: 'terminal', component: 'Pane', requestId: 'yt-briefing', props: PANE_PROPS as never,
  })

  await ui.press({ key: 'ok' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('Something said')
  expect(await ui.find({ key: 'ok' })).toBeDefined()
})

test('engine errors are shown, not swallowed', async ($, on) => {
  host(on, newLog())
  on('process.run', async () => ran(JSON.stringify({ status: 'error', error: 'Claude Code CLI not found' })))

  await $.command.run(YT)
  const ui = await $.ui.mount({
    plugin: 'yt-briefing', surface: 'mobile', component: 'Pane', requestId: 'yt-briefing', props: PANE_PROPS as never,
  })

  expect((await ui.find({ text: 'Claude Code CLI not found' }))?.text).toBeDefined()
})

test('where no pane is placed, /yt hands the loop to the session: text briefing, rating-only dialog', async ($, on) => {
  const calls: string[][] = []
  const log = newLog()
  host(on, log, false)
  on('process.run', async (_$, e) => { calls.push([...e.argv]); return ran('{"ok":true}') })

  const out = await $.command.run(YT)
  for (let i = 0; i < 50 && !log.submitted.length; i++) await new Promise(r => setTimeout(r, 10))

  expect(out.text).toContain('runs in the chat')
  expect(log.closed).toBe(1)
  expect(calls).toEqual([])
  expect(log.submitted).toHaveLength(1)
  expect(log.submitted[0]).toMatch(/yt-sweep\S* --reset/)
  expect(log.submitted[0]).toContain('verbatim')
  expect(log.submitted[0]).toContain('«<pending.title>» — rating?')
  expect(log.submitted[0]).toMatch(/yt-rating\S* --rating 0/)
})
