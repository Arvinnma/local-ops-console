# Local Ops User Guide

[简体中文](USER_GUIDE.zh-CN.md) · [Project README](../README.md) · [Security](../SECURITY.md)

This guide applies to Local Ops v1.8.2 on Apple Silicon macOS.

## 1. Install, update, and open

### Install

1. Download `Local-Ops-1.8.2-arm64.dmg` from GitHub Releases.
2. Open the DMG and drag **Local Ops** to **Applications**.
3. Launch the app from Applications.

On first launch, Local Ops installs its per-user backend at `~/.local/share/local-ops`, creates a random local API token, and starts a LaunchAgent. The DMG already contains Caddy, Process Compose, and the native Keychain helper.

The release is ad-hoc signed rather than Apple-notarized. If Gatekeeper blocks it, Control-click the app in Applications, choose **Open**, and confirm.

### Update

Quit Local Ops, open the newer DMG, and replace the app in Applications. The next launch upgrades bundled backend files while preserving `catalog.json`, `last-session.json`, the local API token, Keychain entries, logs, and portless-access authorization.

The current backend replacement restarts the Local Ops control plane and can also restart managed Process Compose worker processes, including SSH tunnels. Finish active transfers before upgrading and confirm the required services and listeners afterward.

### Window and app behavior

- Closing the main window hides it; the menu-bar panel remains available.
- **Quit App** captures the latest session snapshot and exits the desktop UI.
- The per-user control plane is managed by launchd, so configured routes and already running resources can continue independently of the visible window.

## 2. Resource concepts

- **Managed service**: Local Ops owns the start command and process lifecycle through Process Compose.
- **SSH tunnel**: an SSH connection that binds a local loopback port and forwards traffic through an SSH host.
- **Existing service**: a monitored endpoint that Local Ops probes but does not start or stop.
- **Local domain**: a Caddy route from a `*.localhost` host, optionally with a path, to a loopback target.
- **Terminal action**: a saved command, SSH login, or SSH forward opened in Terminal.app or iTerm2.
- **Docker container**: an existing container read from the local Docker Engine; Local Ops does not create or delete it.

## 3. Overview and Needs Attention

The Overview page shows control-plane uptime, managed-process totals, monitored endpoint availability, local routes, and the number of resources requiring attention.

Select **Needs Attention** to open a detailed list. Each row identifies the resource, reason, and current status, then links to the relevant page. The count can include:

- a managed service or SSH tunnel that is stopped or unhealthy;
- an existing-service health probe that is offline or returns an error;
- a remembered resource that needs manual intervention.

## 4. Menu-bar quick panel

Select the Local Ops status item in the macOS menu bar. The 330 px panel keeps every resource at the first level in this order:

1. Services
2. SSH tunnels
3. Terminal actions
4. Docker containers
5. Reverse-proxy routes

Services, tunnels, terminal actions, and containers use an aligned trailing state column: green is on or ready, red is off, and yellow means an action is in progress. Reverse-proxy rows reserve one half for the display name and one half for the right-aligned web address; they do not show a running-state label.

Selecting a service, tunnel, or container toggles it. Selecting a terminal action runs it. Selecting a route opens it in the default browser. The fixed footer contains Refresh, Show Console, Open in Browser, Open Logs, and Quit App. The panel refreshes every 10 seconds and immediately after actions.

## 5. Managed services

Open **Services → Add Resource → Node / Command Service**.

| Field | Meaning |
| --- | --- |
| Display name | Human-readable list label |
| Unique ID | Stable lowercase identifier used by Process Compose and CLI commands |
| List icon | Brand or tool icon shown in cards and tables |
| Working directory | Absolute project directory |
| Start command | Command executed through the user's login shell |
| Description | Optional explanation shown in the UI |
| Health Check URL | Optional local HTTP endpoint used to report health |
| Group | Visual/process namespace |
| Service type | Node, generic command, or Docker command service |
| Restart after exit | Always, on failure, or never |
| Local domain / path | Optional `*.localhost` route, for example `api.localhost/admin` |
| Service port | Required when a local domain is assigned |
| Auto start | Start when the service scheduler starts |

Example:

```text
Display name: Order API
Unique ID: order-api
Working directory: /Users/you/Projects/order-api
Start command: npm run dev
Health Check URL: http://127.0.0.1:3000/health
Local domain / path: api.localhost
Service port: 3000
```

The left primary action starts or stops the service. The overflow menu contains edit, restart, logs, and delete where applicable. System resources hide unsupported controls. Drag the handle in the Order column; the UI updates immediately and saves the order asynchronously.

## 6. SSH tunnels

The following command maps directly to the SSH tunnel form:

```bash
ssh -NT \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ConnectTimeout=5 \
  -o ConnectionAttempts=1 \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -i ~/.ssh/example_vps \
  -L 127.0.0.1:3000:127.0.0.1:3000 \
  deploy@203.0.113.10
```

Enter `deploy` as SSH User, `203.0.113.10` as SSH Host, `22` as SSH Port, `3000` as Local Port, `127.0.0.1` as Remote Host, `3000` as Remote Port, and the private-key path. The documentation address above is not a real server.

The card separates the SSH hop from the forwarding path:

```text
Via deploy@203.0.113.10
Local listener 127.0.0.1:3000  →  Forward target 127.0.0.1:3000
```

Local Ops automatically adds `-NT`, `IdentitiesOnly`, `ExitOnForwardFailure`, `ConnectTimeout=5`, `ConnectionAttempts=1`, and keepalive options. Managed listeners bind to `127.0.0.1` only. A failed or timed-out SSH attempt exits, then Process Compose waits about three seconds before the next attempt; Local Ops does not add a long fixed boot delay. The tunnel form no longer has a scheduler-autostart option: starts from the web UI, menu bar, or bulk controls retry up to 3 times, while tunnels restored by **Restore the Previous Session When the App Opens** retry up to 40 times.

Before starting SSH automatically, Local Ops runs `ssh -G` to read the effective host configuration. An alias such as `frp-relay-01` is therefore resolved to its real `HostName/Port` first. Every connection round probes that endpoint first. An unreachable endpoint fails that round quickly, keeps the card **Connecting**, and reports the network wait under **SSH Host Network**. Process Compose starts the next round about three seconds later and enters SSH setup immediately once the endpoint recovers.

### End-to-end health checks and states

Configure a local HTTP URL that is reachable through the tunnel, for example:

```text
http://127.0.0.1:18080/
```

A listening local port does not prove the remote application is usable. Local Ops reports **Connected** only after this URL returns a valid HTTP response from 100 through 499. A 500 response, connection failure, or ten-second timeout fails the check; repeated failures terminate the current SSH process and trigger automatic retry.

- **Connecting**: includes waiting for network, establishing SSH, automatic retries, and a manual immediate retry. The primary button is disabled and stale error text is hidden.
- **Connection Failed**: all 40 startup-restoration retries or all 3 manual retries ended without passing verification. The card shows the specific error and enables a yellow **Retry Now** button. Clicking it is a manual action and begins a new three-retry budget.
- **Connected**: the real HTTP path is healthy; when a matching domain entry is configured, that entry must also be ready.
- **Stopped**: the tunnel is disabled; its SSH process and local listener should be absent.

Tunnel cards retain only four diagnostics: SSH Host Network, SSH Tunnel, Tunnel Health Check, and Domain Entry. Error text appears at the bottom only in **Connection Failed**; long errors scroll and remain available in a tooltip. Leaving the health URL blank falls back to a local TCP listener check, which cannot prove the remote target is reachable.

If a Reverse Proxy target matches the tunnel's local listener, Local Ops automatically treats that route as the tunnel's complete domain entry and probes its actual URL, including the configured path. Entry checks accept `2xx`, `3xx`, `401`, and `403`. An authentication-protected service commonly returns `401 Unauthorized` or `403 Forbidden` before login; this proves that the route reached the application, not that user authentication succeeded. A wrong path returning `404`, a `5xx` response, a connection failure, or a ten-second timeout reports **Domain Entry: Not Ready** without restarting an otherwise healthy SSH tunnel. The UI distinguishes:

- **SSH Tunnel: Connected** — the local health URL returned a valid response through the forward.
- **Domain Entry: Ready** — the complete `.localhost` URL, including a protected entry path, returned success or redirect.

The card reports **Connected** only when every configured layer above passes. If no reverse-proxy entry is configured, only the SSH tunnel health check is required.

The entry comes from the existing reverse-proxy configuration. It is never hard-coded for one project and does not add a duplicate field to the SSH tunnel form.

Domain-entry failures follow the active 3- or 40-retry budget. Exhausting that budget reports **Connection Failed**, but it no longer permanently locks the card: Local Ops performs one low-frequency recovery probe every 30 seconds. When the domain entry responds again, the same healthy SSH process automatically returns to **Connected**. UI refreshes inside that interval reuse the recorded result instead of hammering a busy service.

### Encrypted private keys and Keychain

If the private key has a passphrase:

1. Enter the private-key path and passphrase in the tunnel form.
2. Local Ops verifies that the passphrase unlocks that exact key.
3. Its native Security.framework helper stores the value in the macOS login Keychain.
4. Background SSH uses a restricted AskPass helper to answer private-key passphrase prompts only.

The passphrase is never written to `catalog.json`, generated Process Compose YAML, command arguments, logs, API responses, or portable exports. Configuration stores only an opaque random reference, which is also removed from API responses and exports.

When editing, leave the field blank to keep the Keychain value, enter a new value to replace it, or select the removal option to delete it. If the item is missing, Local Ops fails with an explicit error and does not fall back to plaintext storage, account-password authentication, host confirmation, or keyboard-interactive prompts.

## 7. Existing services and reverse proxy

An existing service is a monitor only. For example, an endpoint at `127.0.0.1:4173` can be displayed even when another app owns the Vite process. Local Ops probes its health but never starts or stops it.

Local domains must end in `.localhost`, and targets must be `127.0.0.1:port` or `localhost:port`. A path may follow the domain:

```text
Local domain: panel.localhost/admin_abc
Target:       127.0.0.1:18080
```

Caddy routes by `panel.localhost`, while quick links retain `/admin_abc`.

### Portless access

Without portless access, links include `:19080`. Enabling it installs a root-owned LaunchDaemon, helper, and PF anchor that forward loopback port 80 to Caddy. The App requests administrator authorization once. It never opens port 80 on a LAN interface. The browser-only console cannot request this authorization.

## 8. Docker

The Docker page reads the local Docker CLI and Engine. If Engine is offline, select **Start Docker Desktop** and wait for readiness. You can then start, stop, or restart existing containers individually or start all stopped containers.

Local Ops does not create, remove, rename, export, or change restart policies for containers. Configuration export never includes Docker resources.

When session restore is enabled, Local Ops records stable container identifiers plus Compose project/service information. If remembered containers need to run, it opens Docker Desktop, waits up to two minutes for Engine, and starts only those containers. Missing containers are reported and are not recreated.

## 9. Terminal actions

Choose Terminal.app or iTerm2 and save one of these actions:

- shell command, optionally with a working directory;
- plain SSH login;
- SSH local forward.

SSH terminal actions use the same user, host, port, key, and optional forwarding fields as managed tunnels. They can also save an encrypted-key passphrase in Keychain. Without a saved passphrase, the interactive terminal may prompt normally. The first execution can trigger a macOS Automation permission request allowing Local Ops to control the selected terminal.

## 10. Startup automation and session memory

Both settings are off by default and are independent:

- **Launch at Login** starts Local Ops silently in the menu bar after signing in to macOS. It does not open the main window; use the menu-bar panel to show the console when needed.
- **Restore the Previous Session When the App Opens** restores only custom services, SSH tunnels, and Docker containers that were actually running in the last captured session.

Local Ops records state periodically and when the app quits. Resources that were off stay off. Terminal actions, reverse-proxy links, system control-plane processes, and monitored external services are not restored. If a resource no longer exists, it is skipped. Restore errors are written to desktop logs without blocking the rest of the app.

## 11. Configuration import and export

Exports include:

- custom services and SSH tunnels;
- existing-service monitors;
- reverse-proxy routes;
- terminal actions;
- interface language and startup preferences.

Exports exclude Docker resources, remembered runtime state, local API tokens, private-key contents, private-key passphrases, Keychain references, system ports, and administrator authorization. Re-enter encrypted-key passphrases after importing on another Mac.

Import replaces the included resource collections. Export a backup first. The import is validated before it is applied, and unrelated JSON files are rejected.

## 12. CLI

```bash
localops status                         # core and worker status
localops open                           # open the web console
localops start                          # start the control plane
localops stop                           # stop the control plane
localops restart                        # restart the control plane
localops logs                           # core log
localops logs <process-id> 300          # process log tail
localops process start <process-id>     # start a custom worker process
localops process stop <process-id>
localops process restart <process-id>
localops tui                             # worker Process Compose TUI
localops tui-core                        # core Process Compose TUI
```

## 13. Files and logs

| Path | Purpose |
| --- | --- |
| `~/.local/share/local-ops/config/catalog.json` | Resource configuration |
| `~/.local/share/local-ops/config/last-session.json` | Previous-session memory |
| `~/.local/share/local-ops/config/process-compose.token` | Random local API token |
| `~/.local/share/local-ops/generated/` | Generated Caddy and Process Compose files |
| `~/.local/share/local-ops/runtime/` | Backend and process logs |
| `~/Library/Logs/Local Ops/desktop.log` | Electron app and startup-action log |

Use the overflow menu for process logs or **Open Logs** in the menu-bar footer.

## 14. Troubleshooting

- **A service stops immediately**: inspect Logs and verify the working directory, executable, PATH, and start command.
- **A health check is red**: confirm the endpoint listens locally and returns a status below 500.
- **An SSH tunnel fails**: inspect its last connection error and next retry time, then test the host in Terminal, verify the key path and permissions, confirm the local port is free, and check that the configured HTTP health URL works through the forward. For encrypted keys, confirm the Keychain passphrase indicator too.
- **Keychain asks repeatedly**: unlock the macOS login Keychain and save the passphrase again. Local Ops intentionally does not cache plaintext in files.
- **A local domain does not open**: verify Caddy and the target, check the configured path, and enable portless access if the URL omits `:19080`.
- **Portless access cannot start**: another process may own local port 80. Disable that listener and retry from the App.
- **Docker is unavailable**: install/start Docker Desktop and wait for Engine readiness.
- **A terminal action fails**: verify Terminal/iTerm2 is installed and allow Local Ops under System Settings → Privacy & Security → Automation.
- **The UI is stale**: use Refresh or **Settings → Reload All Configuration**.
- **The app icon looks stale**: remove the old Dock item, launch the new app from Applications, then add it back after macOS refreshes IconServices.

## 15. Uninstall

1. Disable **Portless Access** in Settings first so Local Ops removes its privileged loopback rule.
2. Quit the app.
3. Stop the control plane with `localops stop` if the CLI exists.
4. Remove **Local Ops.app** from Applications.
5. To erase configuration and logs, remove `~/.local/share/local-ops` and `~/Library/Logs/Local Ops`.

Removing local data is permanent. Export configuration first if it may be needed later. Keychain items created by Local Ops can be removed from Keychain Access by searching for `Local Ops SSH`.

## 16. Safety reminders

Do not proxy the console through a public tunnel, do not change API listeners from `127.0.0.1`, do not commit real `catalog.json` or logs, and never copy private keys into this repository. See [SECURITY.md](../SECURITY.md) for the complete boundary model.
