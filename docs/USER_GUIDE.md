# Local Ops User Guide

For the Simplified Chinese guide, see [USER_GUIDE.zh-CN.md](USER_GUIDE.zh-CN.md).

## 1. Concepts

- **Managed service**: Local Ops owns its start command and lifecycle through Process Compose.
- **SSH tunnel**: an SSH connection that binds a local loopback port and forwards it through an SSH host.
- **Existing service**: a monitored endpoint that Local Ops probes but does not start or stop.
- **Local domain**: a Caddy route from `*.localhost` to a local loopback target.
- **Terminal action**: a saved command or SSH session opened in Terminal.app or iTerm2.

## 2. Overview and Needs Attention

The Overview page shows managed-process totals, monitored service availability, local routes, and the number of resources requiring attention. Select **Needs Attention** to see each stopped process, failed health check, or offline monitored service, then jump to the relevant page.

## 3. Services

Select **Add Resource → Node / Command Service**. Required fields are a display name, unique ID, working directory, and start command. Optional fields include a health URL, restart policy, auto-start, namespace, icon, and local domain.

Example:

```text
Working directory: /Users/you/Projects/order-api
Start command: npm run dev
Health URL: http://127.0.0.1:3000/health
Local domain: api.localhost
Service port: 3000
```

The green or red button starts or stops a service. Use the overflow menu for edit, restart, logs, or delete. Drag the handle in the Order column to change saved order.

## 4. SSH tunnels

Example command represented by the form:

```bash
ssh -NT \
  -o IdentitiesOnly=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -i ~/.ssh/example_vps \
  -L 127.0.0.1:3000:127.0.0.1:3000 \
  deploy@203.0.113.10
```

Enter `deploy` as the SSH user, `203.0.113.10` (a documentation-only example address) as the SSH host, `3000` as the local port, `127.0.0.1` as the forwarding target, and `3000` as the remote port. The card displays the SSH hop separately from the forwarding path.

## 5. Existing services and reverse proxy

Existing services are health checks only. A target such as `127.0.0.1:4173` can appear even when Local Ops does not own the process. Local domains must end in `.localhost`, and their targets must use `127.0.0.1` or `localhost`.

Portless access uses a macOS PF rule to forward loopback port 80 to Caddy's internal port. Enabling or repairing it requires one administrator authorization; the browser-only console cannot request that authorization.

## 6. Docker

If Docker Engine is offline, select **Start Docker Desktop**. Startup automation can open Docker Desktop, wait for Engine readiness, and start every stopped container. Local Ops does not create, delete, or export containers.

## 7. Terminal actions

Save a shell command, plain SSH login, or SSH local forward and choose Terminal.app or iTerm2. On first use macOS may ask permission for Local Ops to control that terminal application.

## 8. Startup automation

All options are off by default:

- Launch Local Ops after macOS login.
- Start all stopped custom services when the app opens.
- Connect all stopped SSH tunnels when the app opens.
- Open Docker Desktop, wait for Docker Engine, then start all stopped containers.

## 9. Configuration migration

Exports include services, SSH tunnels, existing-service monitors, reverse proxies, terminal actions, interface language, and non-Docker startup settings. They exclude Docker state and Docker startup preferences, the local API token, private-key contents, system ports, and administrator authorization.

Export a backup before importing because an import replaces the included resource collections.

## 10. Troubleshooting

- **A process stops immediately**: open its overflow menu and inspect Logs; confirm the working directory and start command.
- **A health check is red**: verify that its URL uses the actual local listener and returns a successful HTTP status.
- **An SSH tunnel fails**: test the SSH host and key in Terminal, then verify that the chosen local port is not already in use.
- **A local domain fails**: confirm Caddy is running, the target is listening, and portless access is enabled if the URL omits `:19080`.
- **Docker is unavailable**: install or start Docker Desktop and wait for Engine readiness.
- **The UI is stale**: use Refresh or **Settings → Reload All Configuration**.

Logs are stored under `~/.local/share/local-ops/runtime`.
