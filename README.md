# mcs-playwright-test-progress-mod

A Claude Code mod that turns a test run into a live dashboard, so nobody has to keep asking "update?".

It does not run tests. It reads **one small JSON file** that your test runner keeps up to date, so it works with any runner (Playwright, NUnit, pytest, ...) and any number of parallel lanes. It makes no network calls and writes nothing.

## What you get

| Surface | What it shows |
|---|---|
| **Band above the prompt** | While a run is going: progress bar, `done/total`, passed / failed counts, ETA, a **Dashboard** button and a **Hide** button. |
| **Pane** (`/test-progress`) | Overall progress, per-lane progress, latest results, failures so far, shared-session expiry, and a warning when the run has stopped updating. |
| **Status line** | `Tests 52/116 ✓40 ✗12 · ETA 18m`, then `Tests finished ✓100 ✗16` when done. |
| **Toast** | A one-off notification when a run moves to `finished`. |

### Ends on its own

When a run is done - the runner writes `phase: "finished"`, every test has a result, or every lane is `finished` - the band and status line show the final result for a minute and then **clear themselves**. If a run says it is running but has not updated the file for **5 minutes**, it is treated as **stopped** (with a toast) instead of showing progress forever. A new run (different `started` / `build`) starts a fresh lifecycle, and a finished run found when the session starts stays hidden.

## Install

```
/plugin install mcs-playwright-test-progress-mod --marketplace mcs-dave/mcs-fusion-playwright-test-progress-mod
```

Answer `y` to add the marketplace, then pick a scope. The mod is active at once; no reload is needed. Open the dashboard with `/test-progress`.

## Configuration

| Option (in `/config`) | Default | Meaning |
|---|---|---|
| **Status file** | `~/.claude/playwright-triage/status.json` | Path to the JSON file your runner writes. |

The mod re-reads the file every 5 seconds.

## The status file

See [`examples/status.example.json`](examples/status.example.json) for a full sample.

| Field | Meaning |
|---|---|
| `phase` | `running`, `logging in once`, ... any text. `finished` (or `idle`) ends the run. |
| `totals` | `{ total, done, passed, failed, skipped }` across all lanes. |
| `lanes[]` | One entry per parallel lane: `name`, `classes[]`, `total`, `done`, `passed`, `failed`, `skipped`, `finished`, `recent[]` (`{outcome, test, time}`), `failing[]`. |
| `started`, `updated` | Epoch **seconds**. If `updated` is older than 90 s while running, the pane warns that the run may have stopped. |
| `eta_seconds`, `token_expires`, `build` | Optional. `token_expires` (epoch seconds) shows when a shared login session expires. |

`recent[].outcome` is `Passed`, `Failed`, or anything else (shown as skipped).

**Write the file atomically** (write a temp file, then rename) so the mod never reads half a file.

If the file is missing or invalid JSON, the pane says "No test run found" and shows the path it looked at.

## Using it with the MCS Fusion Playwright run

The MCS Fusion regression triage writes the file from its lane logs (`status.py`, refreshed every 4 s). Any other runner works the same way: parse your logs or result files, build the JSON above, rename it into place.

## Development

```
.claude-plugin/        plugin and marketplace manifests
hooks/register.tsx     the mod: polling, command, band, pane, status line
types/index.d.ts       Status / Snapshot types
tests/                 mod tests (claude-code/testing)
examples/              sample status.json
```

## License

MIT. See [LICENSE](LICENSE).
