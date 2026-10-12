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

export type Snapshot = { status: Status | null; error: string | null; path: string }

declare module 'claude-code' {
  interface PluginState {
    'mcs-playwright-test-progress-mod': { snap: Snapshot | null; isHidden: boolean }
  }
}
