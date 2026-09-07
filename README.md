# Astra Advisor

A Pi extension that uses **Sol Medium** to coordinate work, **Astra High** to advise, **Astra Medium in tmux** to review, and **Sol High** or **Luna High** to implement changes.

Implementation stays in your current Pi/PiBB session. Sol fixes Astra’s findings and returns them to the same persistent reviewer conversation. After a clean local review and your authorization to publish, Sol pushes a feature branch, opens a PR, and requests `@codex review`. Sol then fixes GitHub findings and requests fresh review until Codex explicitly clears the latest commit. The extension never merges.

> **Experimental:** tested locally with Pi 0.85.1 on Linux. Regression tests use a real tmux worker with a simulated Pi reviewer, and simulated GitHub responses. See [validation status](docs/development.md#validation-status) for live checks and remaining gaps.

## Requirements

- Pi with the extension APIs used here; **0.85.1** is the tested version.
- Git, tmux, Node and the `pi` CLI on your `PATH`.
- GitHub CLI (`gh`) authenticated to github.com with permission to push and create PRs. The repository must have the Codex GitHub integration configured for `@codex review`.
- Configured Pi authentication and access to all three models below through `openai-codex`.
- Linux is the tested platform. The code uses Unix filesystem features and `/dev/null`; macOS is unverified and Windows is not currently supported.

| Role | Model | Reasoning |
| --- | --- | --- |
| Coordinator and final report | `gpt-5.6-sol` | Medium |
| Planning advisor | `gpt-6-astra` | High |
| Read-only tmux reviewer | `gpt-6-astra` | Medium |
| Scoped initial implementation | `gpt-5.6-luna` | High |
| Complex implementation and all review fixes | `gpt-5.6-sol` | High |

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
| `/astra-advisor status` | Show saved pipeline state; check local-pass freshness before the GitHub stage. GitHub status is last observed, not a live poll. |
| `/astra-advisor off` | Cancel pending work and disable policy/tools. Completed GitHub writes are not undone. |
| `/astra-advisor reset-review` | Authorize a fresh review cycle for another task or an explicit retry. |

Enablement and review state persist on the active session branch. Each new user run starts with Sol Medium while enabled. Turning the extension off does not restore a previous model or change Pi's global defaults.

A finished or incomplete review is not reset automatically. Use `reset-review` when you want another cycle. Previous reports remain in session history; resetting does not mean the work passed review. Reset closes only the owned tmux session, clears the active pipeline, and leaves existing PRs untouched.

## How a task proceeds

1. **Plan.** Sol gathers evidence and can ask tool-free Astra for advice. Trivial questions can skip this step.
2. **Implement.** Sol selects Luna High for narrow, well-defined work or Sol High for complex, uncertain, or higher-risk changes.
3. **Review in tmux.** Astra Medium inspects the changed code with restricted read-only tools. Sol High fixes confirmed findings, tests, and resubmits to the same Pi session.
4. **Publish when authorized.** After Astra is clean, Sol commits the intended changes on a feature branch. The publication tool checks freshness, pushes without force, creates or updates the PR, and posts `@codex review` for the exact head.
5. **Review on GitHub.** Sol waits for Codex. Findings return to Sol High for fixes, tests, a new commit, and another request. Missing or ambiguous feedback remains pending.
6. **Report.** Once Codex explicitly clears the latest requested commit, Sol reports the PR and limitations. It does not merge.

The tmux worker runs independently while the main session uses wait tools to collect results. Fixes remain in the main session; there is no autonomous executor team. The agent follows the workflow policy; code enforces tool/state checks but cannot force an agent with other tools to use this pipeline.

### Review outcomes

Local Astra states are `reviewing`, `needs_fixes`, `passed`, and `incomplete`. GitHub states are `publishing`, `awaiting_review`, `needs_fixes`, `clean`, and `paused`.

There is no fixed correction-round ceiling. Unchanged local evidence, disputes, necessary deferrals, cancellation, unavailable evidence and operational errors stop the local loop without approval. GitHub findings require a new commit before another request. Disagreements or unproductive correction attempts go back to you.

Astra retains stable finding IDs across rounds. Its `passed` result means no unresolved blockers or essential evidence gaps in inspected evidence. Optional follow-ups may remain; necessary fixes cannot be relabeled as optional to clear review.

GitHub clearance requires the trusted `chatgpt-codex-connector[bot]` account to post a matching reviewed-commit clean message or a thumbs-up on the exact request comment. Findings take precedence. A summary, an eyes reaction, silence, or a timeout is not clearance. The PR/local head and base must still match.

**Returning to Sol Medium is not the same as passing verification.** Neither reviewer’s result is certification or permission to merge.

### When review is expected

The policy requires review for protocol and shared-contract changes, persistence, authentication, package/dependency changes, reload/session/process lifecycle, and releases or deployment behavior. Review is optional for routine low-risk work. You can decline it; the final report should say it was not run.

## Permissions, privacy and cost

Astra's planning call has **no tools**. Its reviewer has only bounded file reading, listing, literal search, and fixed Git inspection operations. It cannot edit files, run tests, execute arbitrary shell commands, delegate, deploy, or approve actions.

The executor keeps the main session's tools and approval hooks. Reviewer tools use their own restricted implementation; they do not inherit arbitrary parent tool hooks.

Important limits:

- File contents and review briefs sent to Astra go to the configured provider. Tests in the brief are executor-reported; Astra does not independently run them.
- Common secret paths are excluded, but credentials embedded in ordinary source or logs can still be exposed. Filename filtering is **not secret detection**.
- Review state and evidence summaries are stored in the main Pi session. Reviewer conversation, jobs and logs are stored under Pi’s agent directory in `astra-advisor/reviews/<cycle>/`. GitHub publication sends committed files and PR/request text to the explicitly selected repository. Do not publish raw session files or unsanitized logs.
- The reviewer is **not an OS sandbox**. Pi extensions themselves run with your user's system access; inspect the source before installing.
- Reviews add model requests, latency and usage. Limits bound the review loop, not the total cost of implementation or the whole session.

See [security and limits](docs/security-and-limits.md) for the exact tool boundary, exclusions and resource limits.

## Test and troubleshoot

From the repository root, with Pi installed:

```sh
pi --no-extensions -e ./tests/run.ts --no-session --mode json -p '/astra-advisor-test'
```

The suite uses temporary files/Git repositories, real owned tmux sessions, a simulated Pi child, and simulated GitHub responses. It makes no inference or GitHub write requests. Confirm the explicit passed-test report; a zero exit code alone is not sufficient.

| Problem | What to check |
| --- | --- |
| Command not found | Restart/reload the backend Pi session and confirm the package is enabled with `pi list` / `pi config`. |
| Required model unavailable | Check `pi --list-models` and Pi authentication. No fallback model is selected automatically. |
| Duplicate commands or tools | Remove the duplicate installation source; do not load a manual copy and the package together. |
| Review cannot inspect a file | It must be within the current workspace and meet the path, file-type and size restrictions. Do not bypass exclusions to expose secrets. |
| Review is incomplete or stale | Read the reported reason. Resolve the issue and use `reset-review` only when you authorize another cycle. |
| Codex has not responded | Keep the request pending. Check the integration and bot availability; never treat silence as a pass. |
| tmux worker cannot authenticate | It uses the same Pi agent directory but a separate CLI process; in-memory provider customizations and env-only auth are not forwarded. |
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
