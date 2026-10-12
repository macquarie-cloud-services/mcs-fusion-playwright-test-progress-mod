import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot, Status } from '../types'

const PANE = 'mcs-test-progress'
const POLL_MS = 3000
const STALE_SECONDS = 90

const snap = atom({ plugin: 'mcs-playwright-test-progress-mod', key: 'snap' } as const, null)
const isHidden = atom({ plugin: 'mcs-playwright-test-progress-mod', key: 'isHidden' } as const, false)

const bar = (done: number, total: number, width: number): string => {
  const ratio = total > 0 ? Math.min(1, done / total) : 0
  const filled = Math.round(ratio * width)

  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const percent = (done: number, total: number): string =>
  total > 0 ? `${Math.round((done / total) * 100)}%` : '0%'

const duration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`

  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const clockTime = (epochSeconds: number): string => {
  const d = new Date(epochSeconds * 1000)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const isRunning = (s: Status): boolean => s.phase !== 'finished' && s.phase !== 'idle'

const summary = (s: Status, withEta: boolean): string => {
  const t = s.totals
  const eta = withEta && s.eta_seconds != null && isRunning(s) ? ` · ETA ${duration(s.eta_seconds)}` : ''

  return `${t.done}/${t.total} ✓${t.passed} ✗${t.failed}${t.skipped > 0 ? ` -${t.skipped}` : ''}${eta}`
}

let lastPhase: string | undefined
let hasSeenRunning = false
let lastStatusLine: string | undefined

async function statusPath($: EngineInterface, options: Record<string, unknown> | undefined): Promise<string> {
  const configured = typeof options?.statusFile === 'string' ? options.statusFile.trim() : ''
  if (configured) return configured
  const home = (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/playwright-triage/status.json`
}

async function poll($: EngineInterface, options: Record<string, unknown> | undefined): Promise<void> {
  const path = await statusPath($, options)
  let next: Snapshot
  try {
    const text = await $.fs.read(path)
    next = { status: JSON.parse(String(text)) as Status, error: null, path }
  } catch (error) {
    next = { status: null, error: 'No status file yet at the path below, or it is not valid JSON.', path }
  }
  await update($, snap, () => next)

  const status = next.status
  let line: string | undefined
  if (status) {
    line = isRunning(status)
      ? `Tests ${summary(status, true)}`
      : `Tests finished ✓${status.totals.passed} ✗${status.totals.failed}`
  }
  if (line !== lastStatusLine) {
    lastStatusLine = line
    $.ui.status(line)
  }

  if (status) {
    if (isRunning(status)) hasSeenRunning = true
    if (status.phase === 'finished' && hasSeenRunning && lastPhase !== 'finished') {
      $.ui.toast(`Test run finished: ✓${status.totals.passed} passed, ✗${status.totals.failed} failed`)
      hasSeenRunning = false
    }
    lastPhase = status.phase
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'test-progress',
      description: 'Show the live test-run dashboard (progress, lanes, failures)',
    })
    void poll($, options)
    $.clock.every(POLL_MS, () => {
      void poll($, options)
    })

    return next(e)
  })

  on('command.run', { command: 'test-progress' }, async $ => {
    await update($, isHidden, () => false)
    await $.ui.open({ id: PANE, title: 'Test progress' })
    await poll($, options)

    return { text: 'Test progress dashboard opened.' }
  })

  // One line above the prompt while a run is going (or just finished).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    const status = s?.status
    const isQuiet = e.props.hasSurvey || !status || (await read($, isHidden))
    if (isQuiet || !status) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const t = status.totals
    const running = isRunning(status)

    return (
      <Box>
        <Text color={running ? 'suggestion' : t.failed > 0 ? 'warning' : 'success'}>
          {running ? 'Tests ' : 'Tests done '}
          {bar(t.done, t.total, 20)} {percent(t.done, t.total)}{' '}
        </Text>
        <Text dimColor>{summary(status, true)} </Text>
        <Button key="open" label="Dashboard" onPress={() => $.ui.open({ id: PANE, title: 'Test progress' })} />
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, snap)
    const rows = e.viewport?.rows ?? 30

    if (!s) {
      return <Text dimColor>Reading the status file…</Text>
    }
    if (!s.status) {
      return (
        <Box flexDirection="column">
          <Text color="warning">No test run found</Text>
          <Text dimColor>{s.error}</Text>
          <Text dimColor>{s.path}</Text>
          <Text dimColor>Start a run that writes this file (see the README), then reopen /test-progress.</Text>
        </Box>
      )
    }

    const status = s.status
    const t = status.totals
    const nowSeconds = (await $.clock.now()) / 1000
    const running = isRunning(status)
    const age = nowSeconds - status.updated
    const isStale = running && age > STALE_SECONDS
    const elapsed = status.started ? nowSeconds - status.started : null
    const tokenLeft = status.token_expires != null ? status.token_expires - nowSeconds : null

    const failures: string[] = []
    for (const lane of status.lanes) {
      for (const name of lane.failing) failures.push(`${lane.name}  ${name}`)
    }
    const recent = status.lanes.flatMap(lane =>
      lane.recent.map(r => ({ lane: lane.name, ...r })),
    )
    const room = Math.max(3, rows - 12 - status.lanes.length)
    const failRoom = Math.max(3, Math.floor(room / 2))

    return (
      <Box flexDirection="column">
        <Text bold color={running ? 'suggestion' : t.failed > 0 ? 'warning' : 'success'}>
          {status.phase.toUpperCase()}
          <Text dimColor>
            {status.build ? `  build ${status.build}` : ''}
            {status.started ? `  started ${clockTime(status.started)}` : ''}
            {elapsed != null ? `  elapsed ${duration(elapsed)}` : ''}
            {running && status.eta_seconds != null ? `  ETA ${duration(status.eta_seconds)}` : ''}
          </Text>
        </Text>
        {isStale && (
          <Text color="warning">No update for {duration(age)} - is the run still going?</Text>
        )}
        {tokenLeft != null && running && (
          <Text color={tokenLeft < 600 ? 'error' : 'subtle'}>
            Shared session {tokenLeft > 0 ? `expires in ${duration(tokenLeft)}` : 'has EXPIRED - refresh it'}
          </Text>
        )}
        <Text> </Text>
        <Text>
          {bar(t.done, t.total, 30)} {t.done}/{t.total} ({percent(t.done, t.total)})
        </Text>
        <Text>
          <Text color="success">✓ {t.passed} passed  </Text>
          <Text color={t.failed > 0 ? 'error' : 'subtle'}>✗ {t.failed} failed  </Text>
          <Text dimColor>- {t.skipped} skipped</Text>
        </Text>
        <Text> </Text>
        <Text bold>Lanes</Text>
        {status.lanes.map(lane => (
          <Text>
            <Text bold>{lane.name} </Text>
            <Text color={lane.finished ? 'success' : 'suggestion'}>{bar(lane.done, lane.total, 14)} </Text>
            {lane.done}/{lane.total}{' '}
            <Text color="success">✓{lane.passed} </Text>
            <Text color={lane.failed > 0 ? 'error' : 'subtle'}>✗{lane.failed} </Text>
            <Text dimColor>{lane.classes.slice(0, 3).join(', ')}{lane.classes.length > 3 ? '…' : ''}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Latest results</Text>
        {recent.length === 0 && <Text dimColor>Nothing has finished yet.</Text>}
        {recent.slice(-room).map(r => (
          <Text>
            <Text color={r.outcome === 'Passed' ? 'success' : r.outcome === 'Failed' ? 'error' : 'subtle'}>
              {r.outcome === 'Passed' ? '✓' : r.outcome === 'Failed' ? '✗' : '-'}{' '}
            </Text>
            <Text dimColor>{r.lane} </Text>
            {r.test} <Text dimColor>({r.time})</Text>
          </Text>
        ))}
        {failures.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold color="error">Failures so far ({failures.length})</Text>
            {failures.slice(-failRoom).map(f => (
              <Text color="error">{f}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
