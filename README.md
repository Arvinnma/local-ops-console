# Local Ops

<p align="center">
  <img src="assets/brand/local-ops-app-icon-1024.svg" width="128" height="128" alt="Local Ops logo">
</p>

<p align="center">
  A local-first macOS control plane for services, SSH tunnels, Docker containers, terminal actions, and memorable <code>*.localhost</code> routes.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/Arvinnma/local-ops-console/releases/latest">Download</a> ·
  <a href="docs/USER_GUIDE.md">User guide</a> ·
  <a href="SECURITY.md">Security</a>
</p>

Local Ops combines an Electron desktop app, a browser console, Process Compose, and Caddy in one drag-to-install DMG. It is designed for developers who run several local processes and SSH forwards but want one place to see, start, stop, and open them.

> [!WARNING]
> Local Ops can execute commands configured by the current macOS user. Its control APIs, SSH listeners, and reverse-proxy targets are deliberately restricted to loopback interfaces. Never expose the console to a LAN or the public internet.

## System requirements

- Apple Silicon Mac (`arm64`)
- macOS 12 Monterey or newer
- Docker Desktop is optional and is required only for Docker controls
- Terminal.app is built in; iTerm2 is optional

Intel (`x64`) packages are not provided in v1.8.1.

## What it manages

| Area | Capabilities |
| --- | --- |
| Services | Add Node or command services; start, stop, restart, edit, reorder, health-check, and inspect logs |
| SSH tunnels | Manage loopback-only local forwards with keepalives and automatic reconnection |
| SSH secrets | Verify encrypted private-key passphrases and store them only in macOS Keychain |
| Existing services | Monitor endpoints already owned by another app without taking over their processes |
| Reverse proxy | Open local services at names such as `http://api.localhost` or `panel.localhost/admin` |
| Docker | Launch Docker Desktop and start, stop, or restart existing containers |
| Terminal actions | Run saved commands, SSH logins, or SSH forwards in Terminal.app or iTerm2 |
| Menu bar | Use a compact 330 px panel for first-level controls and quick links |
| Session restore | Optionally restore only resources that were running in the previous app session |
| Portability | Export and import configuration without Docker state, secrets, tokens, or system authorization |
| Language | Switch the web UI, desktop menus, shell screens, and menu-bar panel between English and Simplified Chinese |

## Install

1. Download `Local-Ops-1.8.1-arm64.dmg` from the [latest release](https://github.com/Arvinnma/local-ops-console/releases/latest).
2. Open the DMG and drag **Local Ops** to **Applications**.
3. Launch **Local Ops** from Applications.

The first launch installs the bundled backend under `~/.local/share/local-ops` and registers its per-user LaunchAgent. Caddy, Process Compose, and the native Keychain helper are included; release users do not need Node.js, Homebrew, Caddy, or Process Compose.

Existing configuration, runtime memory, and the locally generated API token are preserved when a newer app replaces the old app in Applications.

### Gatekeeper notice

The community DMG is ad-hoc signed and is not Apple-notarized. If macOS blocks the first launch, Control-click **Local Ops** in Applications, select **Open**, then confirm. A future notarized distribution requires an Apple Developer ID.

### Optional portless access

By default, Caddy listens at `127.0.0.1:19080`. Settings can install a loopback-only macOS rule that forwards local port `80` to Caddy. macOS asks for an administrator password once; afterward `http://openclaw.localhost` works without `:19080`. The rule can be disabled and removed from Settings.

## First steps

1. Open **Services → Add Resource** and add a working directory plus start command.
2. Optionally assign a local domain and service port.
3. Add SSH local forwards under **SSH Tunnels**. If a private key is encrypted, save its passphrase to Keychain from the form.
4. Use **Reverse Proxy** for services that already run elsewhere.
5. Open the Local Ops menu-bar icon for quick first-level controls.
6. Enable **Restore the Previous Session When the App Opens** only if desired; it is off by default.

The **Needs Attention** card opens a detailed list of every stopped, unhealthy, or offline resource and links to its management page.

See the [complete user guide](docs/USER_GUIDE.md) for field-by-field examples, Keychain behavior, startup semantics, backup scope, CLI commands, updates, uninstall steps, and troubleshooting.

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
          +-- Docker CLI / Terminal.app / iTerm2 (only when requested)
```

User-managed services run in a separate worker. Editing configuration reloads the worker without restarting the desktop window, browser console, or Caddy.

## CLI

The installer creates a `localops` command when it can write to a standard Homebrew bin directory:

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

Project shell scripts load the user's shell setup and call `proxy_on` when that command is available.

## Data and privacy

Local Ops does not require an account or cloud service. Runtime data stays on the Mac:

- `~/.local/share/local-ops/config/catalog.json` — resources and preferences
- `~/.local/share/local-ops/config/last-session.json` — optional runtime memory
- `~/.local/share/local-ops/config/process-compose.token` — random local API token
- `~/.local/share/local-ops/runtime/` — process and control-plane logs
- macOS login Keychain — encrypted-key passphrases

Portable exports exclude Docker resources, runtime memory, API tokens, private-key contents, private-key passphrases, opaque Keychain references, system ports, and administrator authorization.

## Build from source

Build requirements:

- Apple Silicon Mac
- Node.js 22.12 or newer and npm
- Caddy and Process Compose in `PATH`

```bash
brew install node caddy
brew install f1bonacc1/tap/process-compose
npm ci
npm run check
npm test
npm run build:keychain
npm run test:keychain
cd desktop
npm ci
npm run dmg
```

The distributable is written to `desktop/dist/Local-Ops-1.8.1-arm64.dmg`. The bundle step copies the current Caddy and Process Compose binaries into the application package.

Read [Development and Release Guide](docs/DEVELOPMENT.md) before changing packaging, native helpers, loopback bindings, or Electron security settings.

## Verification

The v1.8.1 release gate covers syntax and unit tests, bilingual static-copy coverage, configuration round trips, API security checks, service lifecycle and logs, Caddy path routing, Docker container lifecycle, encrypted-key Keychain integration, repeated menu-bar window restoration, responsive browser QA, application signature and architecture, mounted-DMG layout/signature checks, and an installed-app launch smoke test.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), run `npm run check` and `npm test`, update both languages for user-visible changes, and preserve the local-only boundaries in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Community

- **[linux.do](https://linux.do)** — a thriving developer community.
