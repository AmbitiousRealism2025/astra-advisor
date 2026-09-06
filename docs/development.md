# Development and validation

## Layout

| File | Responsibility |
| --- | --- |
| `index.ts` | Commands, activation policy, session state, outer review cycle and model routing |
| `contracts.ts` | Input/report/state schemas and outcome assessment |
| `workspace.ts` | Restricted filesystem and Git inspection |
| `reviewer.ts` | Fresh-context Astra tool loop and review usage accounting |
| `test.mjs` | Regression tests using fake model responses and temporary files/Git repositories |
| `tests/run.ts` | Test-command adapter loaded by the real Pi runtime |
| `package.json` | Pi package manifest; only `index.ts` is registered as an extension |

There is no build step. Pi loads the TypeScript extension. Core Pi packages and TypeBox are provided by the Pi runtime rather than bundled into this package. For npm-based Pi installations, Pi 0.85.1 requires Node 22.19.0 or newer.

## Run the regression suite

From the repository root:

```sh
pi -e ./tests/run.ts --no-session --mode json -p '/astra-advisor-test'
```

Look for an explicit **`20 tests passed`** report. Pi command errors are not reliably represented by the process exit code alone, so check the output before calling a run successful.

The suite makes no inference requests. It uses real temporary files and Git repositories to exercise path restrictions, hostile external-diff configuration and fingerprints. Fake model responses exercise the reviewer loop and handoff decisions; they do not establish model quality or actual provider behavior.

Coverage includes:

- Bare command, command-plus-task, explicit GUI marker, controls and acknowledgments
- Disabled tools and active-branch restoration
- Tool-free planning and cancellation
- Clean review, fix/recheck success, unchanged evidence and the three-round ceiling
- Disagreements, essential evidence gaps and non-blocking follow-ups
- Stable findings, stale passes, interrupted and corrupt state
- Forbidden tools, review response limits and mixed tool batches
- Traversal, symlinks, credential paths, binary/oversized files and fixed Git operations

### Isolate tests from your personal Pi configuration

On Linux/macOS, use a temporary configuration directory:

```sh
config_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$config_dir" PI_OFFLINE=1 \
  pi -e ./tests/run.ts --no-session --mode json -p '/astra-advisor-test'
```

This avoids loading personal global packages or credentials. Pi can still discover trusted project resources, so run it from this checkout, which does not contain a project-local `.pi` configuration. Remove the temporary directory when finished.

## Smoke-test package discovery

From the repository root, in a session that does not already load another copy:

```sh
pi -e . --no-session --mode json -p '/astra-advisor status'
```

The result should say Astra Advisor is inactive and review has not run. This checks package loading without requiring model inference.

To check real activation and model availability in your configured environment:

```sh
pi -e . --no-session --mode json -p '/astra-advisor'
```

This should emit the activation acknowledgment if all required models/auth are configured. It selects a model but does not ask that model to generate a response. The separate smoke-test process does not activate the extension in another running session.

Do not load this package and a manually installed copy together. Numeric command suffixes or duplicate tools can make a smoke test exercise the wrong source.

## Validation status

The implementation's original local checks used Pi 0.85.1 on Linux:

- 20 regression cases passed through the Pi extension loader.
- Production source passed a strict typecheck against Pi 0.85.1 declarations.
- Real activation emitted its acknowledgment without an inference request.

The standalone publication candidate was also checked with an isolated Pi configuration: all 20 regression cases passed, package discovery loaded the inactive command, and local-path installation/removal worked. A package dry run included only the intended sources, tests and documentation, with no bundled dependencies. Relative Markdown links and basic sensitive-content/path checks passed.

The strict typecheck was an ad hoc local check, not a committed reproducible build or CI job. Do not present it as a passing repository CI check.

Still to validate before claiming broader support:

- A complete live Astra read-only review and correction cycle
- Actual provider model/effort changes across the main-session handoffs
- Activation and custom-message rendering in the intended GUI hosts
- macOS or other Pi versions; Windows requires portability work

## Changing models or behavior

Model IDs/provider selection are fixed in both `index.ts` and `reviewer.ts`. They are not user-configurable settings. If changing the mapping, update both call paths, policy text, acknowledgments, tests and documentation. Never silently fall back to a different model.

Keep schema changes and persisted-state compatibility together. Changes to findings, limits or exit conditions need tests that show the intended transition and failure behavior. Preserve the distinction between returning to the coordinator and passing review.

## Updating the PDF

The HTML source is committed beside the PDF:

- [HTML source](astra-advisor-companion.html)
- [PDF guide](astra-advisor-companion.pdf)

On a machine with Chromium, from the repository root:

```sh
chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$(pwd)/docs/astra-advisor-companion.pdf" \
  "file://$(pwd)/docs/astra-advisor-companion.html"
```

Inspect the output before committing it. Check page count, clipping, code examples, links and whether the wording still matches the implementation. The current guide is three pages. Do not turn local test coverage into a claim of live validation.
