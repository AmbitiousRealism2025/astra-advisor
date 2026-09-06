# Release checklist

Repository: [AmbitiousRealism2025/astra-advisor](https://github.com/AmbitiousRealism2025/astra-advisor). The initial source publication is experimental and MIT-licensed. No tagged release or broader compatibility guarantee is implied; the remaining validation below is still open.

## Decisions for the maintainer

- [x] Confirm `AmbitiousRealism2025/astra-advisor` as the public repository.
- [x] Select MIT, add `LICENSE` with AmbitiousRealism2025 as copyright holder, and update package metadata and README.
- [ ] Confirm the draft `0.1.0` version and whether the first release should be labeled experimental.
- [x] Enable GitHub private vulnerability reporting and add `SECURITY.md` with the reporting link.

`private: true` prevents accidental npm publication; it does not prevent a public GitHub repository or Pi installation from Git. Keep it if distribution is Git-only. The package license is MIT.

## Documentation and installation

- [x] Add the exact GitHub installation URL and repository metadata. Do not advertise a nonexistent release tag.
- [x] Test local-path installation and removal in a clean Pi configuration, not just extension loading from a development directory.
- [ ] Test installing a pinned tag/commit, updating, disabling, and removing the package.
- [x] Confirm only `index.ts` is registered; tests and helper modules must not be auto-loaded as extensions.
- [x] Check relative README/docs links; the included three-page PDF was visually checked when generated.
- [ ] Keep source behavior, README, reference, PDF and portable build specification aligned.

## Behavior and support claims

- [x] Run the copied regression suite in an isolated Pi configuration and check the explicit `20 tests passed` report.
- [ ] Validate a complete live review: inspect -> blocker -> fix -> recheck -> coordinator.
- [ ] Confirm actual provider model/effort selection, cancellation and usage reporting.
- [ ] Verify GUI activation and custom messages in each host you intend to support.
- [ ] Fix/test plain-prompt GUI control parity before advertising it: the fallback status acknowledgment currently precedes the freshness check, and plain-prompt handling is a pre-agent hook rather than an immediate command handler.
- [ ] Keep Linux/Pi 0.85.1 as the tested environment until other combinations have been checked. Do not claim Windows support.
- [ ] Add a reproducible typecheck/CI setup if you want a CI compatibility claim; the existing strict typecheck was a local ad hoc check.

## Public-content review

- [x] Inspect the initial staged file list before pushing.
- [x] Exclude authentication files, settings, sessions, raw logs, backups and local dependency trees.
- [x] Run basic private-path and credential-pattern checks on source, fixtures, Markdown, HTML and extracted PDF text; no matches found. This does not establish absence of all secrets or proprietary content.
- [x] Run Gitleaks 8.30.1 before initial publication; no leaks found. A scanner result is not a security audit or proof that every secret is absent.
- [x] Copy only extension sources and selected documentation, not the entire `~/.pi/agent` directory.
- [x] Review the security documentation without treating its restrictions as proof of an OS sandbox.

Before future releases, recheck the staged changes and rerun the relevant validation. Do not turn the initial local checks into claims of live provider or GUI support.
