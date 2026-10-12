# mcs-playwright-test-progress-mod

A Claude Code mod that turns a test run into a human-friendly live dashboard, so nobody has to keep asking "update?".

- **Band above the prompt** while a run is going: a progress bar, `done/total`, passed / failed counts and an ETA, with a **Dashboard** button.
- **Pane** (`/test-progress`): overall progress, per-lane progress, the latest results, the failures so far, the shared-session expiry, and a warning when the run has stopped updating.
- **Status line**: `Tests 52/116 ✓40 ✗12 · ETA 18m`, and a toast when the run finishes.
- **Ends on its own**: when the run is done (the runner writes `phase: "finished"`, every test has a result, or every lane is `finished`) the band and status line show the final result for a minute and then clear themselves. If a run says it is running but has not updated the file for 5 minutes, it is treated as **stopped** (with a toast) instead of spinning forever. A new run (different `started`/`build`) starts fresh. A finished run found at session start stays hidden.

It does not run tests. It only **reads one small JSON file** that your test runner keeps up to date, so it works with any runner (Playwright, NUnit, pytest, ...) and any number of parallel lanes. It makes no network calls and writes nothing.

## Install

```
/plugin install mcs-playwright-test-progress-mod --marketplace <owner>/<repo>
```

Answer `y` to add the marketplace, then pick a scope. The mod is active at once; no reload is needed.
Then open the dashboard with `/test-progress`.

## The status file

Default path: `~/.claude/playwright-triage/status.json`. Change it in `/config` (option **Status file**) if your runner writes elsewhere. The mod re-reads it every 3 seconds. See [`examples/status.example.json`](examples/status.example.json).

| Field | Meaning |
|---|---|
| `phase` | `running`, `logging in once`, ... any text; `finished` (or `idle`) ends the run. |
| `totals` | `{ total, done, passed, failed, skipped }` across all lanes. |
| `lanes[]` | One entry per parallel lane: `name`, `classes[]`, `total`, `done`, `passed`, `failed`, `skipped`, `finished`, `recent[]` (`{outcome, test, time}`), `failing[]`. |
| `started`, `updated` | Epoch **seconds**. If `updated` is older than 90 s while running, the pane warns that the run may have stopped. |
| `eta_seconds`, `token_expires`, `build` | Optional. `token_expires` (epoch seconds) shows when a shared login session expires. |

Write the file atomically (write a temp file, then rename) so the mod never reads half a file.

## Using it with this repo's Playwright run

The MCS Fusion regression triage writes the file from its lane logs (`status.py`, refreshed every 4 s). Any runner works the same way: parse your logs or result files, build the JSON above, rename it into place.
