# Development and validation

## Layout

| File | Responsibility |
| --- | --- |
| `index.ts` | Commands, policy, persisted local/GitHub states, model handoffs and publication gates |
| `contracts.ts` | Packet/report/local-state schemas and assessment |
| `workspace.ts` | Restricted filesystem/Git inspection and snapshots |
| `reviewer.ts` | Private inspection/report tools, policy and usage helpers |
| `tmux.ts` | Owned session lifecycle, job artifacts and report collection |
| `tmux-worker.mjs` | Pi child launch, bounded output, cancellation and completion artifact |
| `tmux-review-tools.ts` | Explicitly loaded child extension; Medium-model check and structured submission |
| `github.ts` | Validated GitHub APIs, publication reconciliation and feedback classification |
| `process.ts` | Abortable bounded commands and polling delay |
| `test.mjs`, `tests/run.ts` | Regression suite and real Pi command adapter |
| `package.json` | Git-distributed Pi package; only `index.ts` auto-loads |

There is no build step. Pi supplies its SDK and TypeBox when loading TypeScript. The tmux worker uses Node; npm-based Pi 0.85.1 requires Node 22.19.0 or newer. Model selection appears in `index.ts`, `tmux-worker.mjs`, and the child model check. Update all paths, tests and docs when changing it; never silently substitute a model.

## Regression tests

From the repository root, with Pi, Git, tmux and Node available:

```sh
config_dir="$(mktemp -d)"
PI_CODING_AGENT_DIR="$config_dir" PI_OFFLINE=1 \
  pi --no-extensions -e ./tests/run.ts --no-session --mode json \
  -p '/astra-advisor-test' > /tmp/astra-tests.jsonl 2>&1
```

Read the output and require the explicit passed-test report; Pi command errors do not reliably produce a nonzero exit code. Remove the temporary directory after inspection. On Linux desktops, run heavy verification in a memory/CPU-bounded systemd scope.

Tests make no inference or GitHub write requests. They use real temporary files/Git repositories, real uniquely owned tmux sessions, a simulated `pi` child on a temporary PATH, and simulated GitHub responses. They do not reuse or close unrelated tmux sessions.

Coverage includes activation/task forwarding, legacy/corrupt state, planning, private file restrictions, stable findings, four correction rounds sharing one session path, Sol High fix routing, no progress, cancellation, stale/mismatched reports, binary-artifact fingerprints, trusted/commit-bound GitHub feedback, missing and ambiguous responses, pagination/errors, retry-safe publication and isolated tool batches. Simulated child arguments establish transport/configuration behavior, not actual model inference or Pi conversation quality.

## Package smoke checks

In a process that does not load another copy:

```sh
pi --no-extensions -e . --no-session --mode json -p '/astra-advisor status'
```

This should report inactive/no review without inference. A separate `/astra-advisor` invocation in your configured environment checks model/auth availability and the acknowledgment, but does not activate another running session.

Also check local-path installation/removal with an isolated `PI_CODING_AGENT_DIR`, and inspect `npm pack --dry-run --json`. All helper modules and the worker must be included; only `index.ts` belongs in `pi.extensions`. Do not load a manual copy and a package copy together.

## Validation status

The original in-process release was tested with Pi 0.85.1 on Linux, including 20 regression cases, package discovery/install/remove, a local ad hoc strict typecheck and no-inference activation. Those checks do not validate the replacement transport.

The replacement passed 18 local regression cases, including four tmux rounds with a simulated child. Package loading and an ad hoc strict typecheck against Pi 0.85.1 declarations also passed. These are local checks, not repository CI. A live Astra Medium worker started, inspected the repository, and resumed the same Pi session after its first attempt hit a context limit. It then submitted findings; those findings prompted executable-mode freshness coverage and a live GitHub reaction-contract check. Final review clearance is separate from this transport evidence.

Still requires separate validation:

- Real GitHub request/poll/fix/clean behavior in this repository
- Provider effort selection and main-session handoffs in the intended PiBB host
- GUI custom-message rendering and interruption controls
- macOS, other Pi versions, and portability beyond Unix; Windows is unsupported

Record live results separately from fixtures. Do not launch paid inference merely to check extension loading. Repository tests are not a security audit or proof of review quality.

## State compatibility and failure checks

Local state is v2; old in-process approval cannot authorize publication. GitHub state is stored separately. Add tests whenever schemas, association rules, request formats or state transitions change. Never relax missing-feedback behavior into approval to accommodate an unfamiliar bot response.

Interrupted remote writes require reconciliation. Preserve the requested head/PR/comment marker before retrying; do not invent a new request on every timeout. Test changed local/remote heads and bases, not only happy-path responses.

## Documentation and PDF

Update README, reference, security/limits, this guide, release checklist and [portable build specification](build-specification.md) together. The companion HTML is the source for the committed PDF:

```sh
chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$(pwd)/docs/astra-advisor-companion.pdf" \
  "file://$(pwd)/docs/astra-advisor-companion.html"
```

Inspect the rendered pages, extracted text, links and clipping. Keep model effort, both correction loops, pending-not-clean behavior and no-merge rules consistent. Apply Unslop’s available core/Crisp Human rules to unsupported claims and unclear prose; unavailable scanner scripts must not be reported as executed.
