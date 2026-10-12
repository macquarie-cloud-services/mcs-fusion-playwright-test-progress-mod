import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'mcs-playwright-test-progress-mod'

test('the pane draws on terminal and desktop before any status file has been read', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'Pane',
      requestId: 'mcs-test-progress',
      props: {} as never,
      viewport: { rows: 30, columns: 120 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /Reading the status file/ })).toBeDefined()
    await ui.unmount()
  }
})

const STATUS = {
  updated: 1000,
  started: 900,
  phase: 'running',
  totals: { total: 10, done: 4, passed: 3, failed: 1, skipped: 0 },
  lanes: [],
  token_expires: null,
  eta_seconds: 120,
}

test('/test-progress opens the dashboard and reads the status file', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/tester' })
  const reads: string[] = []
  on('fs.read', async (_$, e) => {
    reads.push(e.path)
    return { value: JSON.stringify(STATUS) }
  })
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  const ran = await $.command.run({ command: 'test-progress', args: '' })

  expect(ran.text).toBe('Test progress dashboard opened.')
  expect(opened).toContain('mcs-test-progress')
  expect(reads[0]).toBe('/home/tester/.claude/playwright-triage/status.json')
})

const RUNNING = {
  updated: 1000,
  started: 900,
  phase: 'running',
  build: 'b1',
  totals: { total: 10, done: 4, passed: 3, failed: 1, skipped: 0 },
  lanes: [],
  token_expires: null,
  eta_seconds: 120,
}

test('the progress ends on its own: live while running, the result for a minute, then nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/tester' })
  let status: unknown = RUNNING
  on('fs.read', async () => ({ value: JSON.stringify(status) }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const lines: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', async (_$, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  // 1. running: the status line shows live progress
  await $.command.run({ command: 'test-progress', args: '' })
  expect(lines[lines.length - 1]).toContain('4/10')
  expect(toasts.length).toBe(0)

  // 2. the run finishes: one toast and the final result on the status line
  status = { ...RUNNING, phase: 'finished', totals: { total: 10, done: 10, passed: 8, failed: 2, skipped: 0 }, eta_seconds: null }
  await $.command.run({ command: 'test-progress', args: '' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('finished')
  expect(lines[lines.length - 1]).toContain('finished')

  // 3. a minute later the line clears itself, with no second toast
  await clock.advance(61_000)
  await $.command.run({ command: 'test-progress', args: '' })
  expect(lines[lines.length - 1]).toBeUndefined()
  expect(toasts.length).toBe(1)
})

test('a run that stops updating is treated as ended', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/tester' })
  on('fs.read', async () => ({ value: JSON.stringify(RUNNING) }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const toasts: string[] = []
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.command.run({ command: 'test-progress', args: '' })
  expect(toasts.length).toBe(0)

  // the file is never written again: 6 minutes later it counts as stopped
  await clock.advance(6 * 60_000)
  await $.command.run({ command: 'test-progress', args: '' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('stopped')
})
