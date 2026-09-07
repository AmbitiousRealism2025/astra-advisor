# Tool and state reference

See the [README](../README.md) for installation and everyday use. All primary tools require activation. A busy guard rejects overlapping operations; routing, local review, wait and publication tools must be called alone in their tool batch.

## Primary tools

### `consult_astra({ question, context })`

One tool-free Astra High planning request. It receives the explicit brief, not the parent history. `question` is 1–12,000 characters; `context` is 1–60,000. Include essential restrictions, never secrets. It does not change the main model. Cancellation reaches the provider; empty/error responses fail and truncated responses are labeled. Completed advice includes usage.

### `advisor_route({ role, reason })`

`luna` selects Luna High, `sol` selects Sol High, and `coordinator` selects Sol Medium for subsequent responses in the same session. The reason is 1–2,000 characters. Failed model/effort selection is an error. Routing is not approval.

Coordinator routing rechecks a saved local pass before the GitHub stage. After GitHub clearance it polls again rather than presenting a cached clean result as current.

### `astra_verify({ action, packet })`

`start` launches an owned tmux Pi reviewer. `recheck` starts another turn in the same persisted Pi session after Sol’s fixes. It returns `reviewing`; collect the report with `astra_review_wait`.

```json
{
  "action": "start",
  "packet": {
    "goal": "Preserve the active session if reload fails",
    "invariants": ["A rejected reload leaves the existing session available"],
    "files": ["src/session.ts", "test/session.test.ts"],
    "base": "HEAD",
    "diffSummary": "Added failure recovery around session replacement",
    "tests": [{"command": "actual test command", "result": "actual result and omissions"}],
    "limitations": ["GUI behavior has not been checked"],
    "restrictions": "Essential user/project restrictions. No deployment approval. Never access secrets.",
    "risk": ["lifecycle"],
    "resolutions": []
  }
}
```

The packet is capped at 60,000 serialized characters. All fields are required. `files` contains 1–100 unique relative paths; it is scope metadata, not a read-access allowlist. `base` is `HEAD`, a full commit hash, or `none` only outside Git. The resolved commit is frozen. Risk values are protocol, persistence, authentication, packages, lifecycle, release, low_risk and other. See [contracts.ts](../contracts.ts) for exact bounds.

Rechecks retain goal, invariants, restrictions, risk, baseline input and original files. Correction files may be added. Responses use `resolutions: [{id, action, detail}]`, with action fixed, evidence, disputed or defer. IDs must be unique prior IDs, and every unresolved blocker needs a response. There is no `executor` field: all review fixes route to Sol High.

Tests are executor-reported. Identical file/test evidence stops a recheck; it does not prove whether a changed test result is authentic or a correction is meaningful. Disputed findings and deferred blockers stop incomplete. The GitHub stage cannot be replaced by another local review without a user reset.

### `astra_review_wait({ seconds })`

`seconds` is 0–300. Zero checks once; otherwise the tool polls the owned job about once a second until completion or the polling window ends. Pending remains pending and can be waited on again without starting another reviewer.

On completion, code validates the job identity, report and evidence freshness. `needs_fixes` routes to Sol High; `passed` or `incomplete` routes to Sol Medium. Cancellation signals the worker. Missing/malformed artifacts and worker errors are incomplete, never clean.

### `advisor_publish({ repository, baseBranch, title, body })`

Only use for a publication the user authorized. `repository` is an explicit `owner/repo` on github.com; both origin fetch and push URLs must match. The working directory must be the repository root, the worktree clean, and the current branch a feature branch—not main, master, the repository default or the selected base. The tool never stages or commits files.

First publication requires a fresh clean local review whose frozen baseline equals the current remote base commit. Commit the intended changes with normal main-session tools first. Commit hooks or other changes that alter reviewed content invalidate that gate.

The tool records publication intent before remote writes, pushes the exact commit without force, creates or updates a matching PR, and posts `@codex review` with an exact-head marker. PR bodies include `> AGENT GENERATED`; the caller must follow the repository’s PR template. Title and body are required on every call and are applied to the PR.

A failed write may already have succeeded remotely. State remains `publishing`; retry the same operation/head to reconcile the matching PR and request marker rather than duplicating them. Do not change the commit while reconciliation is pending.

After GitHub findings, Sol fixes/tests/commits, then republishes with the same target. A new commit must descend from the prior head; the known remote head/base must not have changed independently. No force-push or merge is available.

### `advisor_github_wait({ seconds })`

`seconds` is 0–300. The tool polls at intervals of up to 30 seconds. Individual commands have their own timeout, so a polling window is not a strict whole-operation deadline. An ordinary wait timeout stays pending. Cancellation/API errors pause; waiting can be retried after resolving the problem.

The tool checks PR identity, open state, head, base, local branch/head and a clean worktree, then collects paginated reviews, issue comments, inline comments and reactions on the recorded request. The request ID, author, exact body and creation time must still match the saved request.

Only `chatgpt-codex-connector[bot]` with GitHub type `Bot` counts. Feedback must be at or after the recorded request time. Findings must belong to a review of the requested full commit and its original inline-comment commit. Findings take precedence over clean signals.

Clean evidence is either:

- The bot’s `Codex Review: Didn't find any major issues.` response with a matching `**Reviewed commit:**` SHA/prefix; or
- The bot’s `+1` reaction on the exact recorded request comment.

Silence, eyes reactions, unrelated authors, stale commits and generic completed summaries remain pending. These recognized formats are deliberately narrow; a changed bot format may require parser updates, never a guessed pass. Findings route to Sol High; clean/pending/paused results return to Sol Medium. No merge occurs.

## Reviewer process and private tools

Each cycle owns `astra-advisor-<UUID>` in tmux. Jobs live under `<Pi agent dir>/astra-advisor/reviews/<UUID>/<job UUID>/`. `reviewer.jsonl` in the cycle directory is reused through `pi --session` across rounds. Dead panes remain visible; rechecks respawn only the owned idle pane.

The worker selects `openai-codex/gpt-6-astra` with Medium reasoning. It disables extension/skill/template/theme/context discovery and approval prompts, then explicitly loads only the internal reviewer extension. No built-in read/bash/edit tools are exposed. PATH and the Pi agent directory come from the parent; in-memory provider customization and env-only authentication are not forwarded.

Private tools are `review_inspect` (bounded read/list/search/diff/status/log) and `review_submit` (structured report, alone after inspection). The reviewer retains its own conversation, not the main conversation. Only the main session’s Sol makes fixes.

## Findings and persistence

Reports contain `summary`, up to 20 `findings`, and up to 12 essential `evidenceGaps`. Findings have stable A1/A2 IDs, severity blocking/non_blocking, disposition fix_now/separate_task, status open/resolved/disputed/deferred, plus title/evidence/resolution. Every prior ID must remain, including resolved findings; duplicate IDs, dropped findings and blocker downgrades are rejected.

Local states: reviewing → needs_fixes → recheck, or passed/incomplete. There is no fixed cycle round ceiling. Per-round resource bounds still apply. Necessary deferrals, disputes, unstable evidence and failures cannot pass.

Persistence keys are `astra-advisor-enabled`, `astra-advisor-review-v2` and `astra-advisor-github-v1`. Legacy in-process review state cannot authorize publication; a user reset is required. State follows the active session branch. Interrupted jobs retain their descriptor for result/error collection; shutdown/navigation sends cancellation. Generation guards discard late results from a replaced session.

`reset-review` closes only the owned tmux session and clears active pipeline state. Reports/artifacts and existing PRs remain. There is no model-callable reset tool; this policy is not an authentication boundary against an executor with shell/session-control access.

## Freshness limits

Snapshots cover declared and changed/untracked file contents and executable permissions, including bounded binary artifact hashes. Text inspection still rejects binary data. Files inspected outside the declared list are checked too. Unsupported, excluded or oversized snapshot evidence blocks review rather than silently disappearing.

Local-pass freshness is checked before first publication and at coordinator/new-run/status boundaries before the GitHub stage. GitHub fixes intentionally supersede the original local snapshot and require fresh Codex review of each new head. Saved GitHub status is last observed; the wait tool checks live state.

These checks are not continuous monitoring, a transactional filesystem snapshot, or a defense against every concurrent local mutation. New scope, roots or base commits require a user decision and a fresh cycle.
