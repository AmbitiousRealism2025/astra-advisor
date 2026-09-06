# Tool and state reference

This document describes the current implementation. See the [README](../README.md) for installation and everyday use.

## Primary-agent tools

All three tools reject calls while Astra Advisor is disabled. Planning and review share a busy guard: only one Astra request runs at a time.

### `consult_astra`

```json
{
  "question": "Which failure paths need attention?",
  "context": "Relevant evidence and essential user/project restrictions. No secrets."
}
```

A single, tool-free Astra High planning request with a fresh request/session identity. It receives only the explicit brief, not the parent conversation. The main session's selected model does not change.

`question` must be nonempty and at most 12,000 characters; `context` must be nonempty and at most 60,000. Cancellation propagates to the provider. Empty advice and provider errors are surfaced, and incomplete/truncated responses are labeled. Successful responses include provider usage in the tool result.

### `advisor_route`

```json
{
  "role": "luna",
  "reason": "The change is narrow and has a focused regression test."
}
```

| Role | Next model and reasoning |
| --- | --- |
| `luna` | Luna High |
| `sol` | Sol High |
| `coordinator` | Sol Medium |

The reason is required and bounded to 2,000 characters. A preflight hook requires this call to be the only tool call in its batch. Routing changes subsequent responses in the same session; it does not create a worker or grant permission.

Coordinator routing checks the freshness of a saved pass and returns the current review state. If model selection or the requested reasoning level is unavailable, the tool reports an error rather than claiming the handoff succeeded.

### `astra_verify`

Call alone after implementation, tests and diff inspection. A cycle starts with `action: "start"`; a corrective review uses `"recheck"`.

```json
{
  "action": "start",
  "packet": {
    "goal": "Preserve the active session if reload fails",
    "invariants": ["A rejected reload leaves the existing session available"],
    "files": ["src/session.ts", "test/session.test.ts"],
    "base": "HEAD",
    "diffSummary": "Added failure recovery around session replacement",
    "tests": [
      {
        "command": "the actual test command",
        "result": "actual output and result, including failures or omissions"
      }
    ],
    "limitations": ["GUI behavior has not been checked"],
    "restrictions": "Essential project/user instructions. No deployment approval. Do not access secrets.",
    "risk": ["lifecycle"],
    "executor": "sol",
    "resolutions": []
  }
}
```

All fields are required; arrays can be empty where omission of items has meaning. The serialized packet is capped at 60,000 characters. See [contracts.ts](../contracts.ts) for field-level schema bounds.

- `files`: 1–100 unique workspace-relative paths. This list is not a read-access allowlist; the reviewer can inspect other permitted files within the workspace.
- `base`: `HEAD`, a full 40- or 64-character commit hash, or `none` for a non-Git directory. Git baselines are resolved to a commit and frozen for the cycle. A Git workspace cannot deliberately select `none`.
- `risk`: one or more of protocol, persistence, authentication, packages, lifecycle, release, low_risk, or other.
- `executor`: `sol` or `luna`.
- `resolutions`: empty initially; on recheck, objects with `id`, `action` and `detail`. Actions are fixed, evidence, disputed or defer.

Every unresolved blocker needs a response. Resolution IDs must uniquely reference prior findings. Rechecks must retain the goal, invariants, restrictions, risk categories, original baseline input and original files. Correction files may be added.

Tests and restrictions come from the executor's packet, not an automatic dump of the parent's system prompt. The caller must include essential project/user restrictions. Astra cannot independently attest that reported tests ran.

## Reviewer-only tools

The reviewer receives a fresh model context with two private tools. They are not registered as tools in the main session.

- **`review_inspect`:** numbered file reads, bounded listing, literal search, fixed Git diffs, changed/untracked names, and a recent commit summary.
- **`review_submit`:** structured report submission, called alone after inspection.

No Pi child session or extension discovery is started. The loop uses the current Pi model registry for authenticated Astra completions and executes only the private tool allowlist.

## Findings

A report contains `summary`, `findings` and `evidenceGaps`. Each finding includes:

| Field | Values or meaning |
| --- | --- |
| `id` | Stable `A1`, `A2`, … identifier |
| `severity` | `blocking` or `non_blocking` |
| `disposition` | `fix_now` or `separate_task` |
| `status` | `open`, `resolved`, `disputed`, or `deferred` |
| `title` | Short description |
| `evidence` | Supporting file/contract evidence or the positions in a dispute |
| `resolution` | Required correction, check, or decision |

Reports support up to 20 findings and 12 essential evidence gaps. Rechecks must carry every earlier finding ID, including resolved findings. The assessor rejects duplicate IDs, omitted prior findings and blocker downgrades. Resolution requires evidence; changing a blocker to a separate task does not clear it.

Optional limitations belong in the summary. `evidenceGaps` is for missing evidence essential to judging correctness. Classification and whether the evidence supports a finding remain model judgments.

## State and transitions

Review state persists under `astra-advisor-review-v1`; enablement uses `astra-advisor-enabled`. The review stores the cycle ID, round, status/reason, root, frozen baseline, packet/resolutions, report, fingerprints and inspected-file hashes.

| State | Next action |
| --- | --- |
| No review | `start` can begin a cycle. |
| `reviewing` | Astra is inspecting; concurrent requests are rejected. |
| `needs_fixes` | Executor works at High, then can call `recheck`. |
| `passed` | Return to Sol Medium; no automatic extra review. |
| `incomplete` | Return to Sol Medium with unresolved items; no automatic extra review. |

The extension attempts the appropriate model handoff after a completed tool result. Handoff failures are reported separately; they do not silently change the review outcome.

A cycle permits one initial review and two corrective re-reviews. Unchanged file fingerprints and reported test evidence stop a recheck without another model request. That comparison detects identical evidence, not whether a claimed correction is meaningful or whether a test actually ran.

Disputes, necessary deferrals, essential gaps at the round limit, errors, cancellation and unstable evidence result in `incomplete`, not `passed`. An interrupted `reviewing` state restores as incomplete. Corrupt latest state disables activation until an explicit user reset; prior reports remain in history.

The reset command is the only reset surface. There is no model-callable reset tool, and the policy prohibits agents from using other channels to bypass limits. This is not an authentication boundary against an agent that already has arbitrary shell/session-control access.

## Freshness and scope

Before and after review, the extension fingerprints declared files plus changed/untracked files in the current workspace. It also checks files the reviewer read outside the declared list. A changed or unreadable snapshot cannot pass.

Saved passes are checked at coordinator routing, new user runs and the slash `status` command. These checks are not continuous monitoring or a transactional filesystem snapshot. In a plain-prompt GUI invocation, the displayed status acknowledgment is built before the pre-run freshness check; use the dispatched slash command when you need the refreshed status report without running the agent.

All changed/untracked files are included in the Git snapshot, not only the files named by the executor. An unrelated changed binary, oversized or excluded file can therefore make review incomplete. Keep the workspace focused, inspect the reported limitation, and do not treat a narrowed review as verification of excluded changes.

Root changes require a user decision. A new cycle after a finished, stale or incomplete review requires `/astra-advisor reset-review`.
