# Astra Advisor

A Pi extension that uses **Sol Medium** to coordinate work, **Astra High** to advise and review, and **Sol High** or **Luna High** to implement changes.

Implementation stays in your current Pi session. Astra gets a focused planning brief, then can inspect the finished work with read-only tools. If it finds blocking issues, the executor makes corrections and requests a focused recheck.

> **Experimental:** tested locally with Pi 0.85.1 on Linux. The review loop has regression tests with simulated model responses. A full live Astra review cycle, real provider handoffs, and GUI rendering still need separate validation.

## Requirements

- Pi with the extension APIs used here; **0.85.1** is the tested version.
- Git on your `PATH` for repository inspection.
- Configured Pi authentication and access to all three models below through `openai-codex`.
- Linux is the tested platform. The code uses Unix filesystem features and `/dev/null`; macOS is unverified and Windows is not currently supported.

| Role | Model | Reasoning |
| --- | --- | --- |
| Coordinator and final report | `gpt-5.6-sol` | Medium |
| Planning advisor and reviewer | `gpt-6-astra` | High |
| Scoped implementation and fixes | `gpt-5.6-luna` | High |
| Complex implementation and fixes | `gpt-5.6-sol` | High |

Check your available models with `pi --list-models`. The mapping is fixed in the source; there is no model-picker setting or automatic fallback. Activation fails if a required model or its configured authentication is missing. Use Pi's normal login flow—do not paste credentials into a prompt.

## Install

Install from GitHub:

```sh
pi install git:github.com/AmbitiousRealism2025/astra-advisor
```

Restart an existing Pi session or run `/reload` to load it. The unpinned Git source follows the repository's default branch when you update packages; use a specific commit when you need a reproducible installation.

Alternatively, clone or download this repository. From its root, run:

```sh
pi install .
```

Pi registers the local package in your user settings without copying it, so keep the directory in place. Restart an existing Pi session or run `/reload` to load it.

For a one-session trial without registering the package:

```sh
pi -e .
```

**Already using a manually installed copy?** Move that copy out of `~/.pi/agent/extensions/` before loading this package. Keep a backup outside Pi's extension-discovery directories. Loading both copies can register duplicate commands and tools.

This is a **Pi extension**, not a BB plugin. In a GUI, install it on the machine and in the Pi configuration used by the backend session.

## Use

Activate in the Pi terminal interface:

```text
/astra-advisor
```

Or activate and give it a task in one command:

```text
/astra-advisor Investigate and fix the failing tests.
```

In a GUI that sends ordinary prompts to Pi, start your prompt with:

```text
Use /astra-advisor to investigate and fix the failing tests.
```

The extension emits **“Astra Advisor active”**, followed by the model roles. A GUI must render Pi custom messages to display this acknowledgment and the review updates. Ordinary mentions such as “What is astra-advisor?” do not activate it.

| Command | Effect |
| --- | --- |
| `/astra-advisor` | Activate; `on` is an optional alias. |
| `/astra-advisor <task>` | Activate and submit the task once. |
| `/astra-advisor status` | Show enablement and review state; check whether a saved pass is stale. |
| `/astra-advisor off` | Cancel a pending Astra request and disable the extension's policy and tools. |
| `/astra-advisor reset-review` | Authorize a fresh review cycle for another task or an explicit retry. |

Enablement and review state persist on the active session branch. Each new user run starts with Sol Medium while enabled. Turning the extension off does not restore a previous model or change Pi's global defaults.

A finished or incomplete review is not reset automatically. Use `reset-review` when you want another cycle. Previous reports remain in session history; resetting does not mean the work passed review.

## How a task proceeds

1. **Plan.** Sol gathers evidence and can ask tool-free Astra for advice. Trivial questions can skip this step.
2. **Implement.** Sol selects Luna High for narrow, well-defined work or Sol High for complex, uncertain, or higher-risk changes.
3. **Review.** After implementation, tests and diff inspection, Astra reads relevant files, searches code and examines Git changes and history.
4. **Fix or report.** Blocking findings return to the executor. A clear or incomplete review returns to Sol Medium for a final report or a decision from you.

There is no background worker team. Astra requests are synchronous and cancellable. The main agent follows the workflow instructions; extension code validates review-state transitions, enforces limits, and selects the next model. It cannot guarantee that the agent will call the review tool.

### Review outcomes

| Outcome | Meaning |
| --- | --- |
| `passed` | No unresolved blocking findings or essential evidence gaps in the inspected evidence. Optional follow-ups can remain. |
| `needs_fixes` | Blocking findings or missing essential evidence need attention before another review. |
| `incomplete` | The review stopped because of a limit, disagreement, cancellation, error, deferred necessary fix, or unstable evidence. |

A cycle allows **one initial review and up to two corrective re-reviews**. Rechecks retain finding IDs and focus on the corrections. Unchanged file fingerprints and reported test evidence stop another request rather than repeating the same review.

Astra can recommend a separate task for an independent problem or optional improvement. A necessary fix remains blocking even if it is large. Scope expansion and disagreements go back to you; the extension does not automatically file follow-up tasks.

**Returning to Sol Medium is not the same as passing verification.** A pass is an evidence-based model assessment, not proof that the change is correct.

### When review is expected

The policy requires review for protocol and shared-contract changes, persistence, authentication, package/dependency changes, reload/session/process lifecycle, and releases or deployment behavior. Review is optional for routine low-risk work. You can decline it; the final report should say it was not run.

## Permissions, privacy and cost

Astra's planning call has **no tools**. Its reviewer has only bounded file reading, listing, literal search, and fixed Git inspection operations. It cannot edit files, run tests, execute arbitrary shell commands, delegate, deploy, or approve actions.

The executor keeps the main session's tools and approval hooks. Reviewer tools use their own restricted implementation; they do not inherit arbitrary parent tool hooks.

Important limits:

- File contents and review briefs sent to Astra go to the configured provider. Tests in the brief are executor-reported; Astra does not independently run them.
- Common secret paths are excluded, but credentials embedded in ordinary source or logs can still be exposed. Filename filtering is **not secret detection**.
- Review state and evidence summaries are stored in the Pi session. Do not publish raw session files or unsanitized logs.
- The reviewer is **not an OS sandbox**. Pi extensions themselves run with your user's system access; inspect the source before installing.
- Reviews add model requests, latency and usage. Limits bound the review loop, not the total cost of implementation or the whole session.

See [security and limits](docs/security-and-limits.md) for the exact tool boundary, exclusions and resource limits.

## Test and troubleshoot

From the repository root, with Pi installed:

```sh
pi -e ./tests/run.ts --no-session --mode json -p '/astra-advisor-test'
```

The suite uses fake model responses and real temporary files/Git repositories. It makes no inference requests. Confirm that the output contains **`20 tests passed`**; a zero exit code alone is not sufficient.

| Problem | What to check |
| --- | --- |
| Command not found | Restart/reload the backend Pi session and confirm the package is enabled with `pi list` / `pi config`. |
| Required model unavailable | Check `pi --list-models` and Pi authentication. No fallback model is selected automatically. |
| Duplicate commands or tools | Remove the duplicate installation source; do not load a manual copy and the package together. |
| Review cannot inspect a file | It must be within the current workspace and meet the path, file-type and size restrictions. Do not bypass exclusions to expose secrets. |
| Review is incomplete or stale | Read the reported reason. Resolve the issue and use `reset-review` only when you authorize another cycle. |
| No acknowledgment in a GUI | Confirm that the GUI renders Pi custom messages and uses the Pi backend where the extension is installed. |

## Documentation

- [Tool and state reference](docs/reference.md)
- [Security boundary and resource limits](docs/security-and-limits.md)
- [Development and validation](docs/development.md)
- [Plain-language PDF guide](docs/astra-advisor-companion.pdf)
- [Portable build specification for a Pi agent](docs/build-specification.md)
- [Release checklist and remaining validation](docs/release-checklist.md)

## License

[MIT](LICENSE). Copyright © 2026 AmbitiousRealism2025.
