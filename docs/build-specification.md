# Build `/astra-advisor`: a portable brief for a Pi coding agent

## Instructions to the receiving agent

Create and install a Pi extension named **astra-advisor** implementing this specification. This revision adds a read-only Astra reviewer and a bounded fix/recheck cycle.

Inspect the installed Pi version, extension documentation, model registry APIs and examples before coding. Use supported APIs for that version. Implement directly; do not launch a multi-agent workflow merely because this document describes orchestration.

This is a build specification, not an installed extension. Do not claim installation, activation, live inference, or GUI rendering succeeded without verifying it. Preserve existing files and unrelated customizations.

## Goal and roles

Keep **Sol Medium** as the main coordinator, use **Astra High** for planning advice and independent evidence review, and execute with **Luna High** or **Sol High** according to task complexity.

| Role | Preferred model ID | Reasoning |
| --- | --- | --- |
| Coordinator and final synthesis | `gpt-5.6-sol` | `medium` |
| Planning advisor and post-implementation reviewer | `gpt-6-astra` | `high` |
| Scoped executor | `gpt-5.6-luna` | `high` |
| Complex executor | `gpt-5.6-sol` | `high` |

The reference installation uses `openai-codex`. Check model availability and configured authentication. If the mapping is unavailable, report exactly what is missing and ask the user to choose a mapping. Never silently substitute models or invent IDs. Use Pi's authentication resolver; do not read credentials into the conversation or copy secrets into source/configuration.

## Architecture

- Sol and Luna execute in the user's existing session. Model handoffs change subsequent responses without spawning another executor.
- Planning advice is a single, fresh-context, tool-free Astra request.
- Verification is a fresh, bounded Astra model/tool loop exposing only explicitly implemented read-only inspection and structured report submission.
- Verification must not load the parent session's tools, project extensions, background services, or another agent's delegation instructions.
- The primary executor keeps existing tools and approval hooks. Reviewer tools have their own restricted implementation, not automatically inherited parent tool hooks.
- Astra cannot edit files, run tests, execute shell commands, delegate, create tasks, deploy, or approve actions.
- Sol/Luna fixes confirmed problems and runs checks requested by Astra.
- Calls are synchronous and cancellable. Do not imply Sol remains concurrently responsive while awaiting Astra.
- Do not change global default models or unrelated sessions.

## Invocation and acknowledgment

### CLI/TUI

```text
/astra-advisor
/astra-advisor Investigate and fix the failing tests.
```

Bare invocation activates immediately; `on` is an optional compatible alias. Command-plus-task activates, acknowledges, and submits the task exactly once using Pi's supported user-message API. Do not recursively redispatch the command.

### GUI/plain prompt

```text
Use /astra-advisor to investigate and fix the failing tests.
```

Recognize this explicit marker, or a leading `/astra-advisor` passed as ordinary text, before the first model request. It must start the prompt after whitespace, be case-insensitive, and have a token boundary after the command name. Preserve task text and attached images. Ordinary mentions, leading quoted/fenced examples, and `/astra-advisor-other` must not activate it.

### Controls

```text
/astra-advisor status
/astra-advisor off
/astra-advisor reset-review
```

- `status`: report enablement and the current review outcome without activating. Check freshness before reporting a saved pass.
- `off`: cancel any pending Astra request and disable policy/tools. Leave the current model selected; explain that behavior.
- `reset-review`: explicit user authorization for a fresh cycle, such as a new task or retry after an incomplete review. Keep prior reports in history. Do not claim a pass or automatically activate a disabled extension.
- Reserved controls must not become forwarded task text or accidental activation when passed through the supported plain-prompt path.
- Do not expose an agent-callable reset tool. Instruct agents not to use commands or other channels to bypass review limits.

After activation, emit a visible custom message equivalent to:

> Astra Advisor active — Sol Medium coordinates, Astra High advises and reviews with read-only tools, Luna High handles scoped fixes, and Sol High handles complex fixes.

Use `display: true` and a TUI status indicator where supported. Do not rely only on terminal notifications. GUI hosts must render Pi custom messages to display acknowledgments. Emit visible review-start and review-outcome messages too.

## Session persistence

Start disabled in new sessions. Persist enablement and structured review state on the active branch using namespaced custom entries. Re-enabling does not reset a review cycle.

Restore on session load/reload and tree navigation; never take state from abandoned branches. A review interrupted while `reviewing` restores as `incomplete`, retaining the consumed round. Validate persisted data; corrupted state must not become a pass or silently erase limits.

When enabled, start each new user run as Sol Medium and append policy/current review state to the existing system prompt. Never discard existing restrictions or reset the model before every individual response, which would undo handoffs.

Cancel pending work on session shutdown or replacement. Use a generation/session guard so old async completions cannot publish state or switch models in a new session.

## Review-and-fix cycle

```text
Sol Medium gathers evidence
    -> Astra High planning advice (when useful)
    -> Sol/Luna High implementation, tests, and diff inspection
    -> Astra High read-only review
         -> no blockers or essential gaps: Sol Medium reports
         -> fixes/evidence needed: executor works, then Astra rechecks
         -> incomplete/escalation: Sol Medium reports or asks the user
```

The main agent follows instructions and tool results to perform fixes and request rechecks. Extension code must enforce state transitions, review limits and next-model selection. Do not create autonomous background fixes.

### When review is required

Require it by policy for changes involving:

- Protocols and shared contracts
- Persistence, migrations and data integrity
- Authentication, permissions or secrets
- Package installation, updates and dependency resolution
- Reload/session/process lifecycle and host targeting
- Releases and deployment behavior

Allow optional review for routine low-risk work. A user can decline review; the final report must say it was not run. Do not claim the extension can reliably classify risk or force a model to call a tool solely through prompting.

### Limits and exit conditions

Allow **one initial review plus two corrective re-reviews**, not an unbounded approval loop.

- With no unresolved blockers or essential evidence gaps, return to Sol Medium promptly.
- With blockers or essential missing evidence and rounds remaining, route automatically to the selected executor at High.
- Stop without another model call if file fingerprints and reported test evidence are unchanged since the last review. This detects identical evidence, not whether a revision is semantically meaningful.
- Escalate disagreements and necessary fixes deferred beyond scope; preserve both positions.
- At the round limit, or on cancellation, malformed output, provider failure, unstable evidence, or inspection limits, return to Sol Medium with `incomplete`.
- Never convert exhausted limits, deferral, or missing evidence into a pass.
- Permit coordinator handoff even when problems remain. Returning control and passing verification are separate outcomes.
- A fresh cycle requires the user's explicit reset command. Do not erase limits on the next prompt or on reactivation.

### Fix now versus separate task

Astra recommends a disposition with evidence and rationale:

- **Fix now:** necessary for this change to meet requirements safely, including introduced correctness, security, integrity or contract problems.
- **Separate task:** an independent pre-existing issue or optional improvement that can safely be deferred.
- A large necessary fix is still blocking. If it exceeds authorized scope, ask the user rather than silently expanding scope or calling it non-blocking.

The executor checks findings against the repository, fixes confirmed problems and reruns affected checks. It records rejected/disputed findings with reasons. Separate tasks remain proposals; do not file or start them without user authorization.

## Tools exposed to the primary agent

### `consult_astra({ question, context })`

Tool-free planning advice only. Require nonempty strings, with limits of 12,000 and 60,000 characters respectively. Include evidence and essential restrictions, never secrets. No inherited conversation.

Resolve Astra through Pi's authenticated model registry, request high reasoning, use a fresh request/session identity, and forward cancellation. Advice should cover approach, risks, missing evidence and suggested execution tier. Astra must not claim file inspection or execution.

Allow only one Astra consultation/review at a time. Always clear busy state. Surface errors/empty advice and label truncated or incomplete responses. Include available nested usage in tool accounting. Cap parent-facing output at 2,000 lines/50KB.

### `advisor_route({ role, reason })`

Roles: `luna` = Luna High, `sol` = Sol High, `coordinator` = Sol Medium. Require a nonempty bounded reason, check actual model/effort selection success, and report review state with the handoff. Check freshness before reporting a prior pass.

Reject calls while disabled or another Astra request is active. Require routing to be alone in its tool batch using a preflight/tool-call hook. Do not imply a coordinator handoff clears unresolved findings.

### `astra_verify({ action, packet })`

`action` is `start` or `recheck`. Require it to be alone in its tool batch, after implementation, tests and diff inspection. Reject disabled/concurrent calls and invalid state transitions.

Require an explicit packet, no nullable/default-hiding fields:

```json
{
  "goal": "Handle failed session reload without losing the active session",
  "invariants": ["A rejected reload leaves the existing session available"],
  "files": ["src/session.ts", "test/session.test.ts"],
  "base": "HEAD",
  "diffSummary": "Added failure recovery around session replacement",
  "tests": [{ "command": "the actual check command", "result": "actual output/result, including failures or omissions" }],
  "limitations": ["GUI behavior has not been checked"],
  "restrictions": "Essential project/user instructions. No deployment approval. Do not access secrets.",
  "risk": ["lifecycle"],
  "executor": "sol",
  "resolutions": []
}
```

Packet limit: 60,000 characters, with bounded fields and arrays. `risk` values: protocol, persistence, authentication, packages, lifecycle, release, low_risk, other. `executor`: sol or luna.

`base` is HEAD, a full Git commit hash, or `none` only for a non-Git directory. Resolve/freeze the commit for the cycle. Rechecks retain the goal, invariants, restrictions, risk categories, baseline and original file list; corrective files may be added.

Rechecks include `resolutions: [{ id, action, detail }]`, using fixed, evidence, disputed or defer. IDs must uniquely reference previous findings; every unresolved blocker requires a response. Preserve requested checks and actual results rather than relying on the executor's summary alone.

## Read-only tools available to Astra

Create a private `review_inspect` tool with a validated operation enum:

- `read`: numbered file ranges
- `list`: bounded file discovery
- `search`: literal text search, not arbitrary regex execution
- `diff`: fixed Git diff against the frozen baseline for a validated relative file
- `status`: changed/untracked file names in the current workspace
- `log`: a bounded recent Git commit summary

Expose no raw commands, Git arguments, shell, edits, tests, network tools or delegation.

Use canonical workspace-relative paths, reject traversal and symlinks, accept only bounded regular text files, and deny common secret/metadata paths. The reference implementation excludes `.git`, `.pi`, `.bb`, `.pibb`, `.ssh`, `.aws`, `.gnupg`, `node_modules`, `.env*`, common credential filenames, and private-key file extensions.

Secret-name filtering is **not secret detection**. Secrets embedded in normal source/logs remain a risk. Document this and require the user/executor to keep sensitive material out of the review packet and authorized workspace. Do not describe these tools as an OS sandbox against a malicious concurrent process.

For Git operations use fixed argument arrays, literal pathspecs and no shell. Disable external diff/text conversion, filesystem-monitor hooks, optional locks and pagers. Do not run project scripts or tests. Test hostile Git configuration without executing it.

Reference safety bounds per round:

- 12 model responses, 30 inspections
- 180,000 characters accumulated model context
- 12,000 output tokens per request, high reasoning
- 1MiB maximum regular text file
- 3,000 discovery entries / 15 directory levels
- Search: 200 files / approximately 8MiB, up to 100 matches
- Snapshot: 300 changed/untracked files / 8MiB
- 1,000 recorded inspected-file hashes

These bound resource use but are not a total cost guarantee. Validate tool arguments at the private tool boundary; do not trust model output. Label truncated evidence and failures accurately. Do not let insufficient inspection become a clean report.

## Structured findings and state

Astra finishes by calling private `review_submit` alone, with:

```json
{
  "summary": "Concise evidence-based assessment",
  "findings": [{
    "id": "A1",
    "severity": "blocking",
    "disposition": "fix_now",
    "status": "open",
    "title": "Failure path loses the current session",
    "evidence": "Specific file/line or inspected contract evidence",
    "resolution": "Required correction and a focused verification check"
  }],
  "evidenceGaps": []
}
```

Finding enums:

- severity: blocking, non_blocking
- disposition: fix_now, separate_task
- status: open, resolved, disputed, deferred

Keep stable A1, A2, … IDs. Re-reviews carry every prior finding, including resolved ones, with updated evidence/status. Reject duplicate IDs, omitted prior findings, invalid schemas and silent blocker downgrades. Label speculation as uncertainty rather than a confirmed bug.

Derive the outcome in extension code, not from an unvalidated model “pass” string:

- `passed`: no unresolved blockers and no essential evidence gaps
- `needs_fixes`: blockers/gaps remain with rounds available
- `incomplete`: limits, disagreement, necessary deferral, evidence instability, cancellation or errors

Persist cycle ID, version, round, status/reason, root, frozen baseline, packet/resolutions, file/evidence fingerprints, report and inspected-file hashes. Reserve the round before inference so an interrupted review cannot disappear from accounting.

Fingerprint evidence before and after review. Check files Astra inspected beyond the declared list too. A concurrent change means incomplete. Invalidate stale passes at coordinator handoff, new user runs and status checks. These are freshness checks, not a transactional repository snapshot.

Tests in the packet are executor-reported. Astra did not run them. “Passed” means no blocking findings in inspected evidence, not certification or a replacement for testing and external review.

## Deliverables and testing

Prefer global auto-discovery under the receiving Pi configuration directory:

```text
~/.pi/agent/extensions/astra-advisor/index.ts
~/.pi/agent/extensions/astra-advisor/contracts.ts
~/.pi/agent/extensions/astra-advisor/workspace.ts
~/.pi/agent/extensions/astra-advisor/reviewer.ts
~/.pi/agent/extensions/astra-advisor/README.md
~/.pi/agent/extensions/astra-advisor/test.mjs
~/.pi/agent/extensions/astra-advisor/tests/run.ts
```

Equivalent internal structure is acceptable. Keep production types explicit and parse data at boundaries. Avoid unnecessary dependencies and code comments unless the target project's rules/tooling require them.

Test command activation, GUI marker handling, controls, task forwarding, acknowledgments, branch restoration, all model/effort routes, clean review, fix/recheck success, the three-round ceiling, unchanged evidence, disagreements, missing evidence, non-blocking follow-ups, reset behavior, stale passes, interruption/cancellation, provider errors, malformed reports, private tool limits, forbidden tool calls, symlinks/traversal, oversized/binary files and hostile Git diff configuration.

Use fake model responses with real temporary files/Git repositories. Run tests through the actual Pi loader where practical, avoiding fragile source-text rewriting mocks. The reference test command is:

```sh
pi -e ~/.pi/agent/extensions/astra-advisor/tests/run.ts --no-session --mode json -p '/astra-advisor-test'
```

Verify flags against the installed version. Require an explicit passed-test report; a zero exit code alone may not prove an extension command succeeded. Run a real no-inference activation smoke test and typecheck against the installed SDK version when possible.

Do not launch paid live review calls merely to test loading. Report separately whether real Astra inspection, actual provider handoffs and GUI display were tested. The reference implementation has local regression coverage and activation checks; that does not establish live review quality.

## Completion response

Report installed file paths, test results, unverified behavior and reload instructions. Include these examples:

```text
/reload
/astra-advisor
/astra-advisor Investigate and fix the failing tests.
Use /astra-advisor to investigate and fix the failing tests.
/astra-advisor status
/astra-advisor reset-review
```

Keep it concise. Installing the extension or activating it in a separate smoke-test process does not activate it in an already-running user session.
