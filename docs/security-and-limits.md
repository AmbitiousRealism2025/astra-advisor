# Security boundary and resource limits

Astra Advisor separates **read-only review** from **implementation**. That distinction applies to the model's exposed tools, not to the operating-system privileges of the extension itself.

## Trust before installation

Pi extensions run with your user's system access. Inspect this package's source before installing it. The extension is not a sandbox for untrusted code, repositories or other processes on the same machine.

The executor retains the tools and approval hooks already available in the main Pi session. The reviewer has a private tool implementation and does not inherit arbitrary hooks from the parent. Advice and review findings never grant approval.

## What is sent to Astra

Planning sends the explicit question and brief. Review sends the explicit review packet, scope metadata, inspection results, and the reviewer’s retained conversation from this cycle. It runs as Pi Astra Medium in an owned tmux session.

The reviewer can read permitted files throughout the current workspace; the packet's file list is not an access allowlist. It does not receive the full parent conversation or an automatic dump of context files. Essential restrictions must be supplied in the packet. Source code, diffs and logs are untrusted evidence, not authority to change the reviewer's instructions.

Data sent to Astra goes through Pi's configured model provider. The extension does not define provider retention or privacy terms. Main-session state is stored in Pi custom entries. The worker’s persistent Pi session, job/report files and event logs are stored under the Pi agent directory at `astra-advisor/reviews/<cycle>/`, outside the reviewed checkout. Cycle directories are created with mode 0700 and job artifacts with mode 0600. Reset does not erase these records. Sanitize evidence before sending it, and do not publish raw session files or unsanitized logs.

## Allowed operations

The reviewer receives only:

- Text-file reads with line ranges
- Bounded file listing and literal text search
- Fixed Git diff, changed-file and recent-history queries
- Structured report submission

It receives no shell, write/edit tools, tests, arbitrary Git arguments, network tools, delegation, task creation or deployment tools. Only the configured model request itself needs provider network access.

Git is invoked with fixed argument arrays rather than shell text. Calls disable optional locks, filesystem-monitor hooks, external diff/text conversion and pagers. Project test scripts do not run during review.

## File restrictions

Paths must be workspace-relative and remain under the canonical root. Traversal, symlinks, non-regular files and oversized files are excluded. Binary data cannot be exposed through text reads; bounded binary artifacts can be hashed for freshness without being presented as inspected content.

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
| Review cycle | No fixed round ceiling; progress and safe-stop rules apply |
| Model responses per round | 12 |
| Inspection attempts per round | 30 before further attempts return budget errors |
| Accumulated review context | Checked against 600,000 characters before each model request |
| Worker output | 8MiB combined stdout/stderr before cancellation; no separate output-token setting |
| Serialized review packet | 60,000 characters |
| Regular file, including a hashed binary artifact | 1MiB |
| Path | 500 characters, workspace-relative |
| Discovery | 3,000 visited entries, with recursive descent bounded by depth checks |
| Literal search | Up to 200 files, approximately 8MiB, 100 returned matches |
| Git changed/untracked list | 300 files |
| Snapshot content | 8MiB; excluded/unreadable evidence prevents a pass |
| Recorded inspected-file hashes | 1,000 |
| Read-only reviewer Git process | 10 seconds and 2MiB captured output |\n| Main process/tmux/GitHub command | 30 seconds and 4MiB captured output |\n| GitHub listing | At most ten 100-item pages per endpoint; reaching the bound pauses rather than guessing completeness |\n| Returned GitHub findings | 100, with 4,000 characters per body and links to full comments |
| Individual inspection output | Generally 24,000 bytes or 1,500 lines, with truncation labeled |
| Parent-facing advice/review output | 50KB or 2,000 lines, with truncation labeled |

These are implementation bounds, not hard limits on all memory, total cost or elapsed time. Directory reads can allocate entries before the traversal counter is checked. Search can cross its approximate byte threshold on the last file. The main executor and tool-free planning call have separate behavior; the review limits do not cap the entire Pi session.

Usage collected by a successfully submitted worker report is included in the parent tool result. Failed or cancelled workers may not return final usage. The retained Pi session and logs can contain additional accounting; do not assume the parent result measures every failed request.

## GitHub publication boundary

Publication requires explicit user authorization by policy; activation is not permission to publish private or unrelated code. The tool requires an explicit github.com repository matching origin and a clean feature-branch commit. It pushes source and PR/request text through the user’s Git/GitHub credentials. It does not copy credentials into prompts or implement a separate login store.

Unlike the reviewer’s fixed Git inspection, publication uses normal Git push behavior, including configured authentication and hooks. This is an authorized main-session write operation, not part of the read-only boundary. Reviewers never receive the publication tool.

First publication checks local Astra clearance and unchanged evidence. Later corrections require fresh exact-head Codex review. Only the named Codex bot’s commit-bound clean message or thumbs-up on the exact request counts; findings take precedence. API failures, stale heads, missing feedback, and ambiguous summaries never authorize completion. Remote writes can succeed before a timeout: retry the saved publication intent to reconcile them. Cancellation cannot retract an already pushed commit or posted PR/comment.

The tool never force-pushes or merges. A clean result is not merge permission. Authenticated bot output is still untrusted evidence for Sol to evaluate, not instructions to execute shell commands or disclose data. The code validates identity/association but cannot prove the bot’s assessment is correct.

## Findings and review confidence

`passed` means no unresolved blocking findings or essential evidence gaps in the inspected evidence. It is not a security certification or proof that the implementation is correct.

The model assesses severity, relevance, evidence and whether a correction resolves a finding. Code enforces schema/state rules, stable local finding IDs, per-round limits and publication checks. It cannot prove the model's judgment or independently verify executor-reported test results.

Unchanged fingerprints and test evidence detect identical review inputs, not whether a new test result is authentic or a correction is meaningful. A deferred necessary fix remains blocking. Cancellation, disagreements, errors and exhausted limits return incomplete results rather than forced approval.

The reset command is reserved for user authorization by policy. It is not a secure identity check against an executor that already has arbitrary shell or session-control access.

## Reporting a problem

Do not include credentials, private source, raw session files, or unsanitized logs in a public issue. Share a minimal reproduction using synthetic data and state the Pi version, operating system, invocation path and expected versus actual behavior.

Use [GitHub private vulnerability reporting](https://github.com/AmbitiousRealism2025/astra-advisor/security/advisories/new) for vulnerabilities. See the [security reporting policy](../SECURITY.md). Do not post sensitive exploit details publicly.
