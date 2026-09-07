# Build `/astra-advisor`: portable brief for a Pi coding agent

## Task and evidence

Create and install a Pi extension implementing the behavior below. This specification replaces the original in-process Astra High verification loop with a persistent Pi Astra Medium reviewer in tmux and a subsequent GitHub Codex review loop.

Inspect the installed Pi version, SDK, CLI flags, session format and extension examples first. Use supported APIs. Preserve unrelated files and sessions; do not launch a multi-agent workflow merely because this brief describes orchestration. Never claim installation, inference, GUI behavior or publication succeeded without checking it.

## Models and responsibilities

| Role | Provider/model | Reasoning |
| --- | --- | --- |
| Main coordinator and reporting | openai-codex/gpt-5.6-sol | Medium |
| Tool-free planning advisor | openai-codex/gpt-6-astra | High |
| Narrow initial implementation | openai-codex/gpt-5.6-luna | High |
| Complex implementation and all review fixes | openai-codex/gpt-5.6-sol | High |
| Independent tmux reviewer | openai-codex/gpt-6-astra | Medium |

Main execution stays in the user’s existing Pi/PiBB session. Planning is one fresh, explicit-brief model request without tools. Post-implementation review runs in a separate owned tmux Pi session—not Codex CLI, not the old in-process reviewer, and not a fresh `--no-session` conversation each round.

Check model availability/authentication and exact effort. Never silently substitute models. Use Pi’s supported authentication; never read credentials into the conversation or copy secrets into source. A separate CLI worker may not share in-memory provider customization or env-only auth; surface that limitation.

## User interaction

Support these invocations:

```text
/astra-advisor
/astra-advisor Investigate and fix the failing tests.
Use /astra-advisor to investigate and fix the failing tests.
/astra-advisor status
/astra-advisor off
/astra-advisor reset-review
```

Bare/on activation emits “Astra Advisor active” with the correct roles. Command-plus-task forwards the task exactly once. The plain-prompt marker must lead the prompt after whitespace, be case-insensitive, have a token boundary and preserve the original task/attachments. Ordinary mentions, quoted/fenced examples and `/astra-advisor-other` must not activate it.

Use visible Pi custom messages, not only notifications. A GUI must render those messages. Explain that a fallback pre-agent prompt is not the same as an immediately dispatched command.

Status must distinguish saved state from fresh GitHub evidence. Off cancels pending work and disables tools/policy without resetting the model or undoing completed remote writes. Reset is explicit user authorization for a new cycle: close only the owned tmux session, clear active pipeline state, and retain old history/artifacts/PRs. Never expose a model-callable reset or use other channels to evade unresolved findings.

Start disabled in new sessions. Persist validated state on the active Pi session branch. Restore on load/navigation; reject corrupt or incompatible approvals. Each new user run starts on Sol Medium while enabled, but do not reset the model between every tool response. Preserve existing system instructions and approval hooks.

## Required sequence

1. Sol gathers evidence and can consult tool-free Astra High for substantive planning.
2. Sol/Luna High implements in the current session, runs checks and inspects the diff.
3. Sol sends an explicit packet to tmux Astra Medium.
4. Astra inspects read-only and reports structured findings. Sol High validates and fixes confirmed blockers, tests, and sends a recheck to the same reviewer conversation.
5. Repeat after meaningful progress until Astra has no blockers or essential gaps. There is no fixed three-round ceiling.
6. With user authorization to publish this task, Sol commits only the intended changes on a feature branch. Verify reviewed evidence is unchanged before pushing.
7. Push without force, create/update the PR, and post `@codex review` for the exact head.
8. Wait for GitHub. Codex findings return to Sol High for fixes, tests, a new commit, push and a fresh request. Continue until trusted Codex feedback explicitly clears the latest commit.
9. Report the PR, reviewed head and limitations. Never merge automatically.

Missing/delayed feedback, an eyes reaction, a generic completed summary, stale reviews and timeouts are pending—not approval. Stop for user input on disagreement, no progress, necessary scope expansion, missing essential evidence, cancellation or operational failure. Never publish or claim clean because retries stopped. Optional independent work can be proposed separately only when safely deferrable; a large necessary fix remains blocking.

Review is required by policy for protocol/contracts, persistence, authentication, packages, lifecycle and release changes. A user can decline review; report it as skipped, never passed. Policy cannot force an agent with other tools to use the pipeline.

## Primary tools

- `consult_astra({question, context})`: one tool-free Astra High call; 12,000/60,000 character field caps; explicit restrictions and evidence only; no parent history. Forward cancellation and available usage; label truncation/errors.
- `advisor_route({role, reason})`: same-session next-response handoff; luna/sol High, coordinator Sol Medium. Require isolated tool batches and actual selection success. Routing is not approval.
- `astra_verify({action, packet})`: start/recheck the owned tmux review; return reviewing rather than inventing a result.
- `astra_review_wait({seconds})`: 0–300 second polling window; pending can be waited on again without restarting the reviewer. Findings → Sol High, passed/incomplete → Sol Medium.
- `advisor_publish({repository, baseBranch, title, body})`: explicit github.com target, fresh local gate for first publication, retry-safe exact-head push/PR/request. Never stage, commit, force-push or merge. Apply supplied PR metadata and repository template, including an agent-generated disclosure.
- `advisor_github_wait({seconds})`: 0–300 second window with approximately 30-second polling intervals. Validate current head/base/identity, collect all bounded pages, classify trusted feedback and route accordingly.

All tools reject disabled/concurrent operations. All state-changing/handoff/wait calls must be alone in their tool batch. Clear busy state on every exit. Cancellation/navigation must not let late completions write state or change models in a replacement session.

### Review packet

```json
{
  "goal": "Preserve the active session if reload fails",
  "invariants": ["A rejected reload preserves the active session"],
  "files": ["src/session.ts", "test/session.test.ts"],
  "base": "HEAD",
  "diffSummary": "Added failure recovery",
  "tests": [{"command": "actual command", "result": "actual output and omissions"}],
  "limitations": ["GUI behavior not checked"],
  "restrictions": "Essential project/user restrictions. Never access secrets.",
  "risk": ["lifecycle"],
  "resolutions": []
}
```

All fields are required; cap the packet at 60,000 serialized characters and bound every field/array. Files are 1–100 unique relative paths. Risk values: protocol, persistence, authentication, packages, lifecycle, release, low_risk, other. There is no executor selector for fixes: use Sol High.

Freeze HEAD/full hash to a commit. `none` is allowed only outside Git. Rechecks retain goal, invariants, restrictions, risk, baseline input and original files; correction files may be added. Resolutions use prior unique IDs and fixed/evidence/disputed/defer actions with detail; every blocker needs a response. Tests remain executor-reported, not independently run by Astra.

## Persistent tmux reviewer

Use a unique owned session per cycle and a stable Pi `--session` file. Each round has a unique job ID and separate artifacts. Validate all descriptors and reports. Do not reuse/overwrite an unrelated existing tmux session. Respawn only the owned idle pane and keep dead panes available for inspection.

Run Pi with Astra Medium, disable ordinary extension/skill/template/theme/context discovery, and explicitly load only the private reviewer extension. Expose only `review_inspect` and `review_submit`; never expose built-in bash, edits, tests, delegation, network tools or publication. The reviewer retains its own prior conversation, not the main conversation.

Use private directories/artifacts outside the checkout. Bound captured output and command duration. Cancel the worker’s child process group and record a failed/cancelled exit; a missing report or mismatched job identity cannot pass. Keep prior session context across corrective rounds, but allow a safe pause if context/resource limits prevent further review.

### Read-only inspection

Implement bounded numbered reads, listing, literal search, fixed diffs/status/history and structured submission. Canonicalize paths, reject traversal/symlinks/non-regular/oversized files and deny common secret/metadata paths. Disable Git external diff/text conversion, hooks/fsmonitor, pagers and optional locks for reviewer operations. Never run project scripts.

Text reads cannot expose binary data. Bounded binary artifacts may be fingerprinted for freshness without claiming their contents were reviewed. Snapshot declared and all changed/untracked files, and check additionally inspected dependencies before accepting a report and before first publication. These are freshness checks, not transactional snapshots or an OS sandbox.

Reference bounds: 12 turns and 30 inspection attempts per round, 600,000 context characters, 8MiB worker output, 1MiB per regular file, 300 changed/untracked files, 8MiB snapshot, 3,000 discovery entries/depth checks, 200 search files/about 8MiB/100 matches, and 1,000 inspected hashes. Label truncation. Per-round bounds do not cap total implementation or repeated-review cost.

## Reports and state

Reports contain summary, findings and essential evidenceGaps. Each finding has a stable A1/A2 ID, severity blocking/non_blocking, disposition fix_now/separate_task, status open/resolved/disputed/deferred, and title/evidence/resolution. Carry every prior ID, including resolved ones. Reject duplicate IDs, dropped findings and blocker downgrades. Require an actual successful file/diff inspection before submission.

Derive local outcomes in code: reviewing, needs_fixes, passed, incomplete. Passed means no unresolved blockers or essential gaps in inspected evidence—not certification. Identical file/test evidence, disputes, deferred blockers, malformed output, cancelled/failed workers and unstable snapshots cannot pass.

Persist local cycle ID/version/round/root/baseline/packet/report/fingerprints/inspected hashes/tmux descriptor. Persist GitHub target/head/base/branch/PR/author/request ID/time/phase/feedback separately. Old in-process approvals must not authorize the new pipeline without a user reset.

## GitHub association and retries

Require a clean feature branch in the explicit repository root; origin fetch/push URLs must match the requested github.com repository. Reject default/base/main/master branches. Initial remote base must equal the local reviewer’s frozen baseline. GitHub corrections must descend from the prior requested head and must not overwrite independently changed heads/bases.

Record publication intent before remote writes. Timeouts can happen after success: reconcile the matching PR and an exact cycle/head request marker rather than posting duplicates. Keep publishing state until the request is recorded. Do not replace its head while recovery is pending.

Only accept the trusted Codex bot identity and fresh feedback associated with the current request/commit. Inline findings must belong to the matching review and original commit; findings take precedence over clean signals. Recognize an explicit matching reviewed-commit clean message or the bot’s thumbs-up on the exact request comment. Unknown formats remain pending. Recheck PR/head/base while collecting evidence. Pagination limits and API/auth/usage failures pause, never imply approval.

Activation is not authorization to publish unrelated/private code. The main agent must obtain the user’s publication permission and follow repository instructions. No automatic merge operation is part of this feature.

## Delivery and validation

Ship the manifest, command extension, contract/workspace/reviewer/process/tmux/GitHub modules, worker, private child extension, tests and documentation. Register only the main extension for automatic discovery. Preserve existing installations deliberately; do not load duplicate copies.

Test real temporary files/Git repositories, real owned tmux transport with simulated inference, stable session reuse past three rounds, cancellation, no progress, disputes, stale/mismatched artifacts, legacy state, forbidden inspection, binary freshness, publication retries, stale/missing/ambiguous GitHub feedback and trusted latest-head clearance. Simulated tests must not make inference or remote write requests.

Run through the actual Pi loader and require an explicit test report. Smoke-test package loading and typecheck against the installed SDK. Separately record any authorized live Astra/GitHub tests, actual provider handoffs, and GUI behavior; fixture success does not establish them.

Update README, reference, security/limits, development guide, release checklist and companion HTML/PDF. Apply Unslop’s available rules without inventing verification claims. Report installed paths, test results, remaining gaps, PR/main status and reload instructions concisely. Installation or a separate activation smoke test does not activate an already-running session.
