# Changelog

All notable changes to Local Ops are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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
[1.6.0]: https://github.com/Arvinnma/local-ops-console/releases/tag/v1.6.0
