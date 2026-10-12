export type Outcome = 'Passed' | 'Failed' | 'Skipped'

export type Recent = { outcome: Outcome; test: string; time: string }

export type Lane = {
  name: string
  classes: string[]
  total: number
  done: number
  passed: number
  failed: number
  skipped: number
  finished: boolean
  recent: Recent[]
  failing: string[]
}

/** The file the test runner writes (see README). Every field but `phase` and `totals` may be absent. */
export type Status = {
  updated: number
  started: number | null
  phase: string
  totals: { total: number; done: number; passed: number; failed: number; skipped: number }
  lanes: Lane[]
  token_expires: number | null
  eta_seconds: number | null
  build?: string | null
}

/** Why the dashboard considers a run over: the runner said so / every test is done, or it stopped updating. */
export type EndReason = 'finished' | 'stopped'

export type Snapshot = {
  status: Status | null
  error: string | null
  path: string
  /** Epoch seconds when this run was first seen to have ended; null while it is active. */
  endedAt: number | null
  endReason: EndReason | null
}

declare module 'claude-code' {
  interface PluginState {
    'mcs-playwright-test-progress-mod': { snap: Snapshot | null; isHidden: boolean }
  }
}
