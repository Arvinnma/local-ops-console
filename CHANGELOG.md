# Changelog

All notable changes to Local Ops are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.8.7] - 2026-08-15

### Added

- Add event-driven recovery for macOS portless access. Local Ops now repairs the Apple PF main rules before requesting its child anchor only when the configured Caddy port is healthy, loopback port 80 is unavailable, and the installed helper configuration is synchronized.
- Add persistent single-flight, cooldown, and bounded-attempt guards around privileged PF recovery so repeated UI refreshes or App restarts cannot cause a `pfctl` reload loop.

### Fixed

- Keep menu-bar controls actionable while a background snapshot refresh is in progress; only genuinely stale or offline snapshots disable state-changing actions.
- Present a tunnel with a live SSH forward but unavailable application or domain entry as **Service Not Ready** or **Entry Not Ready**, while retaining an explicit Stop action instead of leaving it indefinitely in a disabled **Connecting** state.
- Require an explicit repair request before the privileged portless helper changes PF state, remove one-shot `RunAtLoad` behavior, and reject the enable action when port 80 was not actually restored.

### Testing

- Add PF synchronization, recovery-budget, helper-request, tray-refresh-policy, and tunnel degraded-state regression coverage.

## [1.8.6] - 2026-08-14

### Added

- Add an atomic `/api/snapshot` response with a non-secret catalog revision so the browser console and menu-bar panel can apply configuration, process state, and optional Docker state as one coherent frame.
- Add read-only tunnel diagnostics that preserve the latest historical SSH and domain-entry errors without presenting recovered errors as current failures.

### Fixed

- Serialize ordinary and forced refreshes so an older slow response cannot overwrite a newer state, and guarantee that a forced refresh queued behind ordinary polling performs a genuinely fresh computation.
- Preserve the last successful browser and menu-bar snapshot when the control plane is temporarily unavailable, mark it stale, and disable state-changing actions until a fresh snapshot succeeds.
- Confirm a failed control-plane health probe before switching the menu-bar panel offline, avoiding status flicker from one short timeout.
- Use the same four-state SSH action contract in the browser and menu bar. A failed domain entry with a healthy SSH process now retries only the domain check instead of stopping or restarting the tunnel.
- Clear current user-facing SSH and domain errors after recovery while retaining their historical values under diagnostics.
- Replace Process Compose's lifetime cumulative tunnel restart budget with an independent per-tunnel consecutive-failure supervisor. Attempts 1–9 retry at the existing three-second cadence, attempt 10 becomes terminal, and a verified ten-second stable connection resets the counter to zero.
- Require the SSH forward, loopback listener, optional HTTP readiness check, and stability window before resetting consecutive failures, so a child that starts and immediately exits cannot erase its failure episode.
- Show the current consecutive tunnel failure count in the UI instead of conflating it with the configured retry ceiling.

### Testing

- Add isolated refresh acceptance for stale-data retention, mutation blocking, readable logs, and domain-only retry, plus coordinator, snapshot, tray, tunnel-action, and version-consistency regression coverage.

## [1.8.5] - 2026-08-08

### Added

- Add an editable Caddy internal port to **Settings → Runtime Settings**, with integer, reserved-port, and live-listener validation before applying a change.

### Fixed

- Generate the privileged loopback PF anchor from the configured Caddy port instead of hard-coding `19080`.
- Detect when the installed portless forwarding rule and the active Caddy port disagree, and guide the user to repair the rule instead of reporting every healthy SSH tunnel as failed.
- Apply Caddy port changes atomically, reload the runtime configuration, and restore the previous catalog if rendering or reload fails.

## [1.8.4] - 2026-08-05

### Fixed

- Require a trusted menu-bar click and an explicit confirmation before stopping a managed service or SSH tunnel.
- Reject unconfirmed menu-bar tunnel stop requests in the control API instead of persisting them as deliberate user stops.
- Record menu-bar stop event names, action IDs, call paths, and confirmed user intent in lifecycle and tunnel audit state.
- Preserve a previously remembered tunnel when session capture encounters an unconfirmed menu-bar stop, preventing accidental bulk stops from becoming the next-launch baseline.

## [1.8.3] - 2026-08-01

### Fixed

- Keep the main console catalog synchronized with `/api/bootstrap` during normal refreshes, so tunnels, services, routes, terminal actions, and settings added by another client appear without reopening the App.
- Increase tunnel and complete-domain HTTP readiness timeouts from two to ten seconds so busy forwarded services do not produce false failures.
- Treat complete-domain `401` and `403` responses as reachable authentication boundaries while keeping `404`, `5xx`, connection failures, and timeouts unready.
- Throttle normal domain-entry retries to the existing three-second cadence and let a terminal domain failure probe once every 30 seconds, automatically recovering without restarting a healthy SSH process.
- Separate SSH/TCP tunnel liveness from optional HTTP application readiness. A slow, unavailable, or `5xx` application now reports degraded readiness without terminating the SSH process or consuming its restart budget.
- Remove user-service HTTP readiness/liveness probes from generated Process Compose configuration so an unavailable dashboard upstream does not enter an unbounded restart loop.
- Persist process desired state and auditable start/stop metadata, including the requesting UI, API, menu-bar, startup, or orchestrator source.
- Preserve desired-running services and tunnels when session capture overlaps a short Process Compose restart window.
- Reconcile managed HTTP-service state with the real child process when Process Compose loses track of it, preventing a surviving dashboard from being duplicated.
- Block duplicate starts on an occupied loopback health port, keep the supervisor in a stable degraded state instead of restarting forever, and clean the complete process tree on stop or restart.

### Documentation

- Document cross-client resource synchronization and add it to the release regression checklist.
- Add an authoritative public/private baseline record and a repeatable release/hotfix regression manual.
- Document the current backend-upgrade worker restart caveat and the distinction between readiness success and successful user authentication.

## [1.8.2] - 2026-07-21

### Fixed

- Start login-launched builds silently in the menu bar without showing the Dock icon or main window until the user opens the console.
- Prevent development-mode Electron runs from registering `Electron.app` as a macOS login item.
- Make generated SSH connections fail within five seconds, attempt only once, and let Process Compose retry managed tunnels every three seconds.
- Keep managed tunnels in the user-facing **Connecting** state during network wait, SSH setup, and automatic retry until their configured HTTP health check succeeds.
- Remove per-tunnel scheduler autostart, cap every user-triggered connection at 3 retries, and give startup session restoration a separate 40-retry budget; only report **Connection Failed** after the active budget is exhausted.
- Reduce tunnel cards to four clear states—Connected, Connecting, Connection Failed, and Stopped—and show a scrolling error only after a final failure.
- Hide stale Process Compose PIDs after a managed process has stopped.
- Make repeated start/stop requests idempotent so rapid UI actions cannot create duplicate SSH processes or surface a false server error.
- Resolve effective SSH aliases and wait on the real `HostName/Port` before creating an automatic tunnel, exposing the network wait in diagnostics without reporting a false connection.
- Keep the three-second retry cadence without a fixed boot delay, and make an unavailable SSH endpoint fail fast so Process Compose can count every retry against the configured limit.
- Derive complete domain-entry checks from matching reverse-proxy routes and require every configured layer to pass before a tunnel card reports **Connected**.

## [1.8.1] - 2026-07-20

### Fixed

- Re-enable the menu-bar **Control Panel** action after every invocation so the main window can be reopened repeatedly.
- Restore and focus the macOS main window reliably after it has been hidden, minimized, or left inactive.
- Add regression coverage for repeated menu-bar actions and native window activation behavior.

## [1.8.0] - 2026-07-19

### Added

- A custom macOS menu-bar panel for configured services, SSH tunnels, reverse-proxy links, terminal actions, and Docker containers.
- Live menu-bar panel status summaries with Simplified Chinese and English labels.
- Stacked first-level resource cards, aligned trailing status labels, and a true two-column name/address layout for reverse-proxy rows.
- A menu-bar **Quit App** action and optional access paths appended directly to `.localhost` routes.
- Canonical 1024 × 1024 SVG brand sources with reproducible PNG, ICNS, and menu-bar icon generation.
- Previous-session memory that restores only the services, SSH tunnels, and Docker containers that were running when Local Ops last closed.
- Native macOS Keychain storage and AskPass-based unlocking for encrypted SSH private keys used by managed tunnels and terminal actions.
- Bilingual native application menus, startup/offline screens, menu-bar controls, validation messages, and API error presentation.
- End-to-end release tests for control-plane security, service lifecycle, logs, optimistic ordering, Caddy path routing, configuration migration, Docker lifecycle, and Keychain integration.

### Changed

- Replaced the legacy bar-chart logo with the Local Gateway identity across the web console, startup screen, macOS app icon, and menu bar.
- Gave the redesigned macOS icon a new bundle resource name and internal build number so Dock and IconServices do not reuse the legacy icon cache.
- Replaced the three start-everything preferences with one explicit previous-session restore switch; launch-at-login remains independent.
- Standardized every resource row on one primary start/stop action plus an overflow menu, while hiding unsupported actions on protected resources.
- Documented Apple Silicon installation, updates, runtime data, configuration migration, troubleshooting, uninstall, and release verification in both languages.

### Fixed

- Target iTerm2 by its stable bundle identifier so terminal actions work when the application bundle is named `iTerm.app`.
- Validate encrypted private-key passphrases before saving and fail fast when a required Keychain item is unavailable.
- Return validation failures as client errors instead of generic server failures.
- Preserve complete tables at narrow window widths with horizontal scrolling and keep action controls aligned.
- Localize required-field validation in English mode and keep toast notifications above add/edit dialogs.
- Keep resource icon colors and overflow-menu positioning compatible with the strict `style-src 'self'` Content Security Policy.

### Security

- Restricted SSH AskPass to private-key passphrase prompts and rejected host confirmation, account-password, and keyboard-interactive prompts.
- Kept passphrases and opaque Keychain references out of logs, generated commands, API responses, and portable exports.
- Added release-gate secret scans for both Git history and the complete working tree.

## [1.7.0] - 2026-07-19

### Added

- Detailed Needs Attention dialog for stopped, unhealthy, and offline resources.
- Simplified Chinese and English interface switch with persistent settings.
- Portable configuration import and export, excluding Docker state and local secrets.
- Drag-only optimistic ordering for services, SSH tunnels, reverse proxies, and terminal actions.
- Resource icon library, terminal actions, Docker container controls, and startup automation.
- Compact primary-action plus overflow-menu controls across resource lists.

### Changed

- Standardized action spacing and responsive horizontal scrolling for all tables.
- Reorganized Settings so Security Boundaries appears before Runtime Settings.
- Improved SSH tunnel cards to distinguish the SSH hop, local listener, and forwarding target.
- Expanded open-source documentation, security guidance, and build instructions.

### Security

- Portable exports exclude Docker resources, API tokens, SSH key contents, system forwarding rules, and administrator authorization.
- Control APIs, SSH listeners, and reverse-proxy targets remain limited to loopback interfaces.

## [1.6.0] - 2026-07-17

- Added the self-contained Electron DMG, automatic backend installation, portless loopback access, and bundled Caddy / Process Compose binaries.

[1.7.0]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.7.0
[1.8.7]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.7
[1.8.6]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.6
[1.8.5]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.5
[1.8.4]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.4
[1.8.3]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.3
[1.8.2]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.2
[1.8.1]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.1
[1.8.0]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.0
[1.6.0]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.6.0
