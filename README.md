# Local Ops

[简体中文](README.zh-CN.md) · [Latest release](https://github.com/Arvinnma/local-ops-console/releases/latest) · [User guide](docs/USER_GUIDE.md) · [Security](SECURITY.md)

Local Ops is a local-first macOS control plane for services, SSH tunnels, Docker containers, terminal tasks, and memorable `*.localhost` routes. It combines an Electron desktop app, a browser console, Process Compose, and Caddy in one installable DMG.

> Local Ops can execute commands configured by the current macOS user. Its APIs and proxy targets are intentionally restricted to loopback interfaces. Do not expose the console to a LAN or the public internet.

## Highlights

- Start, stop, restart, reorder, edit, and inspect logs for Node or command-based services.
- Maintain SSH local-forward tunnels with keepalives and automatic reconnection.
- Open local services through names such as `http://openclaw.localhost`.
- Inspect and control local Docker containers, including launching Docker Desktop when required.
- Save Terminal.app or iTerm2 commands and SSH sessions for one-click execution.
- Monitor services that are already managed elsewhere without taking ownership of them.
- Open a detailed **Needs Attention** list for stopped, unhealthy, or offline resources.
- Export and import portable configuration without copying Docker state, secrets, or administrator authorization.
- Switch the interface between Simplified Chinese and English.
- Use an Apple Silicon DMG that bundles Caddy and Process Compose; end users do not need Node.js.

## Architecture

```text
Local Ops.app / browser
          |
          v
Local control API (127.0.0.1:19090)
          |
          +-- Process Compose Core (console, Caddy, scheduler)
          +-- Process Compose Worker (user services and SSH tunnels)
          +-- Caddy (127.0.0.1:19080; optional loopback port 80 entry)
```

User-managed services run in a separate worker. Editing resources therefore does not restart the Electron window, browser console, or Caddy.

## Install the release

Requirements: macOS on Apple Silicon (`arm64`).

1. Download `Local-Ops-1.7.0-arm64.dmg` from the [latest release](https://github.com/Arvinnma/local-ops-console/releases/latest).
2. Open the DMG and drag **Local Ops** to **Applications**.
3. Launch **Local Ops** from Applications.

The first launch installs the bundled local backend under `~/.local/share/local-ops`. Existing configuration and the locally generated API token are preserved across app upgrades.

Local Ops can optionally request administrator authorization once to forward loopback port `80` to Caddy. This enables `http://openclaw.localhost` without `:19080`. The rule only affects `127.0.0.1` and `::1` and can be removed from Settings.

The release currently uses an ad-hoc local signature and is not Apple-notarized. If Gatekeeper blocks the first launch, use **Control-click → Open**. Public distribution should use a Developer ID signature and notarization.

## Quick start

- **Overview**: inspect control-plane health, managed processes, quick links, monitored services, and Needs Attention details.
- **Services**: add a working directory, start command, restart policy, health URL, and optional local domain.
- **SSH Tunnels**: configure the SSH hop plus a local listener and forwarding target.
- **Reverse Proxy**: map a `*.localhost` host to a loopback target.
- **Docker**: start Docker Desktop, then start, stop, or restart containers.
- **Terminal**: save a command, SSH login, or SSH local-forward action for Terminal.app or iTerm2.
- **Settings**: configure startup automation, portless access, language, and configuration migration.

See the [complete user guide](docs/USER_GUIDE.md) for field examples, automation behavior, CLI commands, backup scope, and troubleshooting.

## CLI

When the installer can write to the Homebrew bin directory, it creates a `localops` command:

```bash
localops status
localops open
localops start
localops stop
localops restart
localops logs <process-id> 300
localops process start <process-id>
localops process stop <process-id>
localops process restart <process-id>
localops tui
localops tui-core
```

Project shell scripts load the user's shell setup and call `proxy_on` when available.

## Build from source

Build requirements:

- Apple Silicon Mac
- Node.js 22.12 or newer and npm
- Caddy and Process Compose available in `PATH`

```bash
brew install node caddy
brew install f1bonacc1/tap/process-compose
npm install
npm test
npm run check
cd desktop
npm install
npm run dmg
```

The distributable is written to `desktop/dist/Local-Ops-1.7.0-arm64.dmg`. `desktop/scripts/prepare-bundle.zsh` copies the current Caddy and Process Compose binaries into the application bundle.

For the development workflow, local installation, architecture, and release checklist, see [Development](docs/DEVELOPMENT.md).

## Local data and security

The repository intentionally excludes:

- `config/catalog.json` — the current machine's real services, tunnels, routes, terminal actions, and preferences.
- `config/process-compose.token` — a randomly generated local API token.
- `runtime/` and `generated/` — logs and generated runtime configuration.
- Electron dependencies, app bundles, DMGs, and generated icons.

Only `config/catalog.example.json` and safe templates are versioned. SSH private keys are referenced by path and are never copied into exported configuration or the app bundle. Read [SECURITY.md](SECURITY.md) before changing network binding or Electron security settings.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), run `npm test` and `npm run check`, and keep all control APIs bound to loopback interfaces.

## License

[MIT](LICENSE). Third-party icon and component notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
