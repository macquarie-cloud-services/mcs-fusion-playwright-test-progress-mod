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
