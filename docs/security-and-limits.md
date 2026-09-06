# Security boundary and resource limits

Astra Advisor separates **read-only review** from **implementation**. That distinction applies to the model's exposed tools, not to the operating-system privileges of the extension itself.

## Trust before installation

Pi extensions run with your user's system access. Inspect this package's source before installing it. The extension is not a sandbox for untrusted code, repositories or other processes on the same machine.

The executor retains the tools and approval hooks already available in the main Pi session. The reviewer has a private tool implementation and does not inherit arbitrary hooks from the parent. Advice and review findings never grant approval.

## What is sent to Astra

Planning sends the explicit question and brief. Review sends the explicit review packet, earlier findings, scope metadata, and results of the inspection tools Astra calls.

The reviewer can read permitted files throughout the current workspace; the packet's file list is not an access allowlist. It does not receive the full parent conversation or an automatic dump of context files. Essential restrictions must be supplied in the packet. Source code, diffs and logs are untrusted evidence, not authority to change the reviewer's instructions.

Data sent to Astra goes through Pi's configured model provider. The extension does not define provider retention or privacy terms. Review packets, findings and state are also stored in the local Pi session. Sanitize evidence before sending it, and do not publish raw session files or unsanitized logs.

## Allowed operations

The reviewer receives only:

- Text-file reads with line ranges
- Bounded file listing and literal text search
- Fixed Git diff, changed-file and recent-history queries
- Structured report submission

It receives no shell, write/edit tools, tests, arbitrary Git arguments, network tools, delegation, task creation or deployment tools. Only the configured model request itself needs provider network access.

Git is invoked with fixed argument arrays rather than shell text. Calls disable optional locks, filesystem-monitor hooks, external diff/text conversion and pagers. Project test scripts do not run during review.

## File restrictions

Paths must be workspace-relative and remain under the canonical root. Traversal, symlinks, binary files, non-regular files and oversized files are excluded.

Excluded path components include:

- `.git`, `.pi`, `.bb`, `.pibb`
- `.ssh`, `.aws`, `.gnupg`, `node_modules`
- `.env` and `.env.*`
- `auth.json`, common `credentials` / `secret` / `secrets` filenames and their dotted variants
- `id_rsa*`, `id_ed25519*`
- Files ending in `.pem`, `.key`, `.p12`, `.pfx` or `.keystore`

See [workspace.ts](../workspace.ts) for the exact patterns.

These checks are **not secret detection**. A token embedded in an ordinary source file, a log or a differently named configuration file can still be sent to the provider. Do not authorize review of a workspace containing sensitive material the provider should not receive.

The checks are also not an OS-level containment boundary against a malicious process changing paths or filesystem objects concurrently. Freshness checks reduce stale-review mistakes; they do not provide a transactional snapshot or defend against every filesystem race.

## Bounds

| Resource | Current bound |
| --- | --- |
| Review cycle | Initial review plus two corrective re-reviews |
| Model responses per round | 12 |
| Inspection attempts per round | 30 before further attempts return budget errors |
| Accumulated review context | Checked against 180,000 characters before each model request |
| Output per review model request | 12,000 tokens |
| Serialized review packet | 60,000 characters |
| Text file | 1MiB |
| Path | 500 characters, workspace-relative |
| Discovery | 3,000 visited entries, with recursive descent bounded by depth checks |
| Literal search | Up to 200 files, approximately 8MiB, 100 returned matches |
| Git changed/untracked list | 300 files |
| Snapshot content | 8MiB; excluded/unreadable evidence prevents a pass |
| Recorded inspected-file hashes | 1,000 |
| Individual Git process | 10 seconds and 2MiB captured output |
| Individual inspection output | Generally 24,000 bytes or 1,500 lines, with truncation labeled |
| Parent-facing advice/review output | 50KB or 2,000 lines, with truncation labeled |

These are implementation bounds, not hard limits on all memory, total cost or elapsed time. Directory reads can allocate entries before the traversal counter is checked. Search can cross its approximate byte threshold on the last file. The main executor and tool-free planning call have separate behavior; the review limits do not cap the entire Pi session.

Available usage from completed nested review requests is included in the parent tool result, including incomplete rounds. A transport failure may not provide final usage.

## Findings and review confidence

`passed` means no unresolved blocking findings or essential evidence gaps in the inspected evidence. It is not a security certification or proof that the implementation is correct.

The model assesses severity, relevance, evidence and whether a correction resolves a finding. Code enforces schema/state rules, stable finding IDs and review limits. It cannot prove the model's judgment or independently verify executor-reported test results.

Unchanged fingerprints and test evidence detect identical review inputs, not whether a new test result is authentic or a correction is meaningful. A deferred necessary fix remains blocking. Cancellation, disagreements, errors and exhausted limits return incomplete results rather than forced approval.

The reset command is reserved for user authorization by policy. It is not a secure identity check against an executor that already has arbitrary shell or session-control access.

## Reporting a problem

Do not include credentials, private source, raw session files, or unsanitized logs in a public issue. Share a minimal reproduction using synthetic data and state the Pi version, operating system, invocation path and expected versus actual behavior.

Use [GitHub private vulnerability reporting](https://github.com/AmbitiousRealism2025/astra-advisor/security/advisories/new) for vulnerabilities. See the [security reporting policy](../SECURITY.md). Do not post sensitive exploit details publicly.
