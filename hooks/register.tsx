import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EndReason, Snapshot, Status } from '../types'

const PANE = 'mcs-test-progress'
const POLL_MS = 3000
const STALE_SECONDS = 90
// A run that says it is running but has not written the status file for this long is treated as stopped.
const STOPPED_AFTER_SECONDS = 300
// How long the band and status line keep the final result on screen after a run ends, then clear themselves.
const END_LINGER_SECONDS = 60

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

const isIdle = (s: Status): boolean => s.phase === 'idle'

// Done: the runner says so, every test has a result, or every lane has finished.
const isDone = (s: Status): boolean =>
  s.phase === 'finished' ||
  (s.totals.total > 0 && s.totals.done >= s.totals.total) ||
  (s.lanes.length > 0 && s.lanes.every(lane => lane.finished))

const isStopped = (s: Status, nowSeconds: number): boolean =>
  !isDone(s) && !isIdle(s) && nowSeconds - s.updated > STOPPED_AFTER_SECONDS

// Still going: not done, not stopped, not idle.
const isRunning = (s: Status, nowSeconds: number): boolean =>
  !isDone(s) && !isIdle(s) && !isStopped(s, nowSeconds)

// What the band and status line show: the live run, or the final result for a minute after it ends.
const isVisible = (snapshot: Snapshot | null, nowSeconds: number): boolean => {
  const status = snapshot?.status
  if (!snapshot || !status || isIdle(status)) return false
  if (snapshot.endedAt === null) return isRunning(status, nowSeconds)

  return nowSeconds - snapshot.endedAt < END_LINGER_SECONDS
}

const summary = (s: Status, withEta: boolean): string => {
  const t = s.totals
  const eta = withEta && s.eta_seconds != null ? ` · ETA ${duration(s.eta_seconds)}` : ''

  return `${t.done}/${t.total} ✓${t.passed} ✗${t.failed}${t.skipped > 0 ? ` -${t.skipped}` : ''}${eta}`
}

let runKey: string | undefined
let hasSeenActive = false
let endedAt: number | null = null
let endReason: EndReason | null = null
let lastStatusLine: string | undefined

async function statusPath($: EngineInterface, options: Record<string, unknown> | undefined): Promise<string> {
  const configured = typeof options?.statusFile === 'string' ? options.statusFile.trim() : ''
  if (configured) return configured
  const home = (await $.env.get('HOME')) ?? ''

  return `${home}/.claude/playwright-triage/status.json`
}

async function poll($: EngineInterface, options: Record<string, unknown> | undefined): Promise<void> {
  const path = await statusPath($, options)
  const nowSeconds = (await $.clock.now()) / 1000
  let status: Status | null = null
  let error: string | null = null
  try {
    const text = await $.fs.read(path)
    status = JSON.parse(String(text)) as Status
  } catch (failure) {
    error = 'No status file yet at the path below, or it is not valid JSON.'
  }

  if (status) {
    // A new run (different start time or build) starts a fresh lifecycle.
    const key = `${status.started ?? ''}|${status.build ?? ''}`
    if (key !== runKey) {
      runKey = key
      hasSeenActive = false
      endedAt = null
      endReason = null
    }

    const reason: EndReason | null = isDone(status) ? 'finished' : isStopped(status, nowSeconds) ? 'stopped' : null
    if (isRunning(status, nowSeconds)) hasSeenActive = true

    if (reason && endedAt === null) {
      // Only a run we watched end gets the toast and the lingering result; an old finished run found at
      // start-up is already "ended" long ago, so the band stays hidden.
      endedAt = hasSeenActive ? nowSeconds : status.updated
      endReason = reason
      if (hasSeenActive) {
        $.ui.toast(
          reason === 'finished'
            ? `Test run finished: ✓${status.totals.passed} passed, ✗${status.totals.failed} failed`
            : `Test run stopped updating: ✓${status.totals.passed} ✗${status.totals.failed} of ${status.totals.total} done`,
        )
      }
    }
    if (!reason) {
      // The run is active again (for example the runner started writing after a pause).
      endedAt = null
      endReason = null
    }
  }

  const next: Snapshot = { status, error, path, endedAt, endReason }
  await update($, snap, () => next)

  let line: string | undefined
  if (status && isVisible(next, nowSeconds)) {
    line =
      endedAt === null
        ? `Tests ${summary(status, true)}`
        : endReason === 'stopped'
          ? `Tests stopped ✓${status.totals.passed} ✗${status.totals.failed} (${status.totals.done}/${status.totals.total})`
          : `Tests finished ✓${status.totals.passed} ✗${status.totals.failed}`
  }
  if (line !== lastStatusLine) {
    lastStatusLine = line
    $.ui.status(line)
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

  // One line above the prompt while a run is going; after it ends the final result stays for a minute, then the band clears itself.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    const status = s?.status
    const nowSeconds = (await $.clock.now()) / 1000
    const isQuiet = e.props.hasSurvey || !status || (await read($, isHidden)) || !isVisible(s, nowSeconds)
    if (isQuiet || !status || !s) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const t = status.totals
    const ended = s.endedAt !== null
    const stopped = s.endReason === 'stopped'
    const label = !ended ? 'Tests ' : stopped ? 'Tests stopped ' : 'Tests finished '

    return (
      <Box>
        <Text color={!ended ? 'suggestion' : stopped ? 'warning' : t.failed > 0 ? 'warning' : 'success'}>
          {label}
          {bar(t.done, t.total, 20)} {percent(t.done, t.total)}{' '}
        </Text>
        <Text dimColor>{summary(status, !ended)} </Text>
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
    const running = isRunning(status, nowSeconds)
    const stopped = s.endReason === 'stopped'
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
        <Text bold color={running ? 'suggestion' : stopped ? 'warning' : t.failed > 0 ? 'warning' : 'success'}>
          {running ? status.phase.toUpperCase() : stopped ? 'STOPPED' : 'FINISHED'}
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
        {stopped && (
          <Text color="warning">The run stopped updating {duration(age)} ago, so the dashboard treats it as ended.</Text>
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
