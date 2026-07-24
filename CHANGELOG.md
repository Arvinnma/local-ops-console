# Changelog

All notable changes to Local Ops are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Increase tunnel and complete-domain HTTP readiness timeouts from two to ten seconds so busy forwarded services do not produce false failures.
- Treat complete-domain `401` and `403` responses as reachable authentication boundaries while keeping `404`, `5xx`, connection failures, and timeouts unready.
- Throttle normal domain-entry retries to the existing three-second cadence and let a terminal domain failure probe once every 30 seconds, automatically recovering without restarting a healthy SSH process.

### Documentation

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
[1.8.2]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.2
[1.8.1]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.1
[1.8.0]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.8.0
[1.6.0]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.6.0
