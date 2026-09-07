# Release checklist

Repository: [AmbitiousRealism2025/astra-advisor](https://github.com/AmbitiousRealism2025/astra-advisor). Version 0.2.0 replaces in-process verification with tmux Astra Medium and GitHub Codex review. Distribution remains experimental and MIT-licensed; no tagged release or broader compatibility guarantee is implied.

## Distribution

- [x] Public repository, MIT license and private vulnerability reporting are configured.
- [x] Git installation URL and package metadata are documented.
- [x] Only `index.ts` auto-loads; worker/private tools are explicit helper files in the package manifest.
- [x] Repeat package install/remove and dry-run contents checks for this replacement.
- [ ] Validate pinned Git installation and update behavior before claiming reproducible-release support.

`private: true` prevents npm publication, not GitHub publication or Pi Git installation. Do not advertise an uncreated tag.

## Behavior

- [x] Replacement regression suite passed 18 cases with real owned tmux transport and simulated inference/GitHub responses.
- [x] Replacement source passed an ad hoc strict typecheck against Pi 0.85.1 declarations; this is not repository CI.
- [x] Package-loading smoke check returned inactive/no review without inference.
- [x] Record live Astra startup, inspection, same-session resumption and structured findings. Final clearance is a separate result.
- [ ] Record real GitHub request, findings/corrections and explicit latest-head clearance.
- [ ] Validate actual main-session provider handoffs and GUI rendering/interruption behavior in each supported host.
- [ ] Validate macOS/other Pi versions before extending the Linux/Pi 0.85.1 support claim. Windows remains unsupported.

Missing or ambiguous review feedback is pending. Cancellation, errors, disagreement or no progress never authorize publication or merge. This feature never merges automatically.

## Documentation and public content

- [x] Update README, reference, security/limits, development guide, portable specification and companion HTML for both review loops.
- [x] Regenerate and visually inspect all three PDF pages.
- [x] Synchronize the requested external Markdown/HTML/PDF copies.
- [x] Apply available Unslop core/Crisp Human rules manually; scanner scripts were unavailable.
- [x] Check relative links and package contents.
- [ ] Recheck the final staged files.
- [x] Gitleaks found no leaks in source/docs; repeat the scan on the final candidate and extracted PDF text. Scanner success is not proof that all sensitive content is absent.
- [x] Synchronize the installed extension with a backup outside auto-discovery directories; reload is required.

Do not publish authentication, settings, session artifacts, raw logs, local dependencies or backups. Preserve the distinction between fixture coverage, live checks and unverified behavior. Review and test the final diff before publication.
