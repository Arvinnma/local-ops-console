# Release and Hotfix Regression Manual

This checklist is mandatory for a public release, a private packaged hotfix, or an installed-backend replacement. The current code/runtime baselines are recorded in [Authoritative Project Status](PROJECT_STATUS.md).

## 1. Establish the intended baseline

Run from the repository root:

```bash
proxy_on >/dev/null 2>&1
git status --short --branch
git rev-parse HEAD
git remote -v
git ls-remote forgejo refs/heads/main
git ls-remote origin refs/heads/main
git rev-parse 'v1.8.6^{}'
```

Record these separately:

- public GitHub `main`, public release tag, published artifact name, and SHA-256;
- private Forgejo `main`, latest runtime-affecting commit, private artifact name, and SHA-256;
- installed App version, bundle build time, and installed backend source hash.

Never imply that a private post-release commit is already present in an older public tag or DMG. Do not replace a published artifact in place.

## 2. Static and unit gates

```bash
proxy_on >/dev/null 2>&1
npm run check
npm test
node --test \
  tests/config.test.mjs \
  tests/process-lifecycle.test.mjs \
  tests/service-health.test.mjs \
  tests/tunnel-network.test.mjs \
  tests/tunnel-http-health.test.mjs \
  tests/tunnel-health.test.mjs \
  tests/tunnel-ui.test.mjs
git diff --check
```

For a complete release, also run:

```bash
proxy_on >/dev/null 2>&1
npm run build:keychain
npm run test:keychain
npm run test:smoke
npm run test:browser
```

The smoke and browser gates can mutate temporary Local Ops resources. Do not run them against irreplaceable user data without first reviewing their temporary IDs and cleanup behavior. Docker mutation coverage remains opt-in.

Resource synchronization regression:

1. Open the main console and record the visible service, tunnel, route, and terminal-action IDs.
2. Add one temporary resource through the HTTP API after the page has completed its initial bootstrap.
3. Wait for one normal UI polling interval without reopening the window.
4. Confirm that the new resource appears in the correct page and that the existing runtime state remains unchanged.
5. Repeat with a route or terminal action, then delete every temporary resource.
6. Confirm that changing only bootstrap metadata such as the CSRF token does not trigger a catalog rerender.

## 3. Cold-start and network-readiness regression

Use a disposable tunnel or isolated catalog. Do not disconnect a production transfer merely to exercise this gate.

Verify:

1. `ssh -G <alias>` resolves the effective host and port used by the network gate.
2. With the SSH endpoint unavailable, the card says **Connecting / Waiting for Network** and never **Connected**.
3. There is no fixed long startup sleep.
4. Each SSH attempt contains `ConnectTimeout=5` and `ConnectionAttempts=1`.
5. The per-tunnel supervisor starts the next round at roughly three-second intervals.
6. Attempts 1 through 9 remain retryable; the tenth consecutive failure enters the terminal state.
7. The counter is independent for every tunnel and survives a supervisor restart without silently granting a fresh budget.
8. A child start does not reset the counter before the local listener, optional health URL, and ten-second stability window succeed.
9. After the stable window, the counter is zero; a later outage starts at failure 1.
10. When the endpoint becomes reachable, the next retry connects without manual intervention.
11. Only one SSH process owns the configured local listener.
12. Stopping the tunnel removes both the SSH process and listener.

## 4. Liveness and HTTP readiness matrix

SSH liveness, forwarded-application readiness, and complete domain-entry readiness intentionally use different policies:

| Probe | Healthy / ready | Unhealthy / not ready | Lifecycle effect |
| --- | --- | --- | --- |
| SSH/TCP liveness | Managed SSH process and local listener exist | Process exited or listener unavailable | May drive SSH retry |
| Optional tunnel application readiness | HTTP `100–499` within 10 seconds | `5xx`, connection/DNS failure, timeout | Degraded only; never kills SSH |
| Complete `.localhost` domain entry | `2xx`, `3xx`, `401`, `403` within 10 seconds | `404`, other `4xx`, `5xx`, connection/DNS failure, timeout | Presentation/recovery probes only; never kills SSH |

Important interpretation:

- `401 Unauthorized` and `403 Forbidden` are successful **readiness** results only for the complete domain entry. They prove that Caddy, the SSH forward, and the authentication-protected service answered.
- They do not prove that credentials are valid or that the user can complete a login.
- `404` remains a failure because it commonly indicates an incorrect protected entry path.
- A local TCP listener proves tunnel liveness, not remote application readiness.
- Neither HTTP readiness layer may consume Process Compose restart attempts or terminate an otherwise live SSH process.

Regression cases:

1. Return repeated `503` responses and timeouts from the optional application readiness URL; the SSH PID, listener, and Process Compose restart count must remain unchanged.
2. Restore the application response to `200`; readiness must recover automatically without restarting SSH.
3. Delay protected domain responses for more than two seconds but less than ten seconds; `401` and `403` must still become ready.
4. Fail a domain entry until its presentation retry budget is exhausted; it may show the terminal failure between probes.
5. Restore the entry and wait for the 30-second recovery interval; the same running SSH process must return to **Connected**.
6. Confirm that repeated UI refreshes inside the interval do not create high-frequency HTTP probes.
7. Confirm that a domain-only failure does not restart a healthy SSH process.

## 5. Desired-state, stop-audit, and service-degradation regression

Use an isolated runtime directory. Do not stop production resources for this gate.

1. Start a managed service and tunnel, then capture a session while Process Compose temporarily reports them stopped. Their desired-running IDs must remain remembered.
2. Stop one resource through the web UI and one through the HTTP API. Inspect `runtime/process-lifecycle.json` and confirm `requestedBy`, `reason`, and ISO timestamp are preserved.
3. Restart a tunnel and confirm the runner's stopped state carries `restart_requested` rather than an empty reason.
4. Return `503` or a timeout from a managed service's health URL. Its process PID and restart count must remain unchanged while the UI reports **Service Degraded**.
5. Restore the health endpoint to `200`; the same service process must recover to healthy.
6. Generate worker YAML and confirm user services and tunnels contain no `readiness_probe` or `liveness_probe`.
7. Force Process Compose to report a managed HTTP service as exited while its tracked child remains alive; the API must reconcile to the real child PID without launching a duplicate.
8. Occupy the configured loopback health port before start; Local Ops must remain degraded with one supervisor, must not launch the command, and must not accumulate restarts.
9. Stop the service and confirm the tracked child and every descendant process are gone. Start and restart it once each, then verify exactly one listener owner remains.
10. Dispatch a synthetic or untrusted menu-bar row click and confirm that no mutation is sent. A real stop click must show a confirmation before the API request.
11. Send a menu-bar tunnel stop without `X-Local-Ops-User-Intent-Confirmed: true`; the API must return `409`, record no explicit stop, and preserve the previously remembered tunnel during session capture.
12. Confirm a menu-bar stop and verify `eventName`, `actionId`, `callPath`, `userIntentConfirmed`, source, reason, and timestamp in `runtime/process-lifecycle.json`.

## 6. Package and installed-runtime verification

Before packaging, run the isolated refresh acceptance in addition to the unit suite:

```bash
proxy_on >/dev/null 2>&1
npm run check
npm test
npm run test:refresh-isolated
git diff --check
```

The isolated acceptance must prove that a snapshot failure retains the previous service/tunnel list, disables service/SSH/Docker/terminal/sort mutations, keeps logs readable, and that a domain-only tunnel retry calls only the entry recheck endpoint rather than a Process Compose restart.

Before packaging, verify configurable portless access in an isolated catalog:

1. Render the PF anchor with a non-default valid Caddy port and confirm both IPv4 and IPv6 rules use the selected value.
2. Reject ports below `1024`, above `65535`, fractional values, Local Ops control-plane ports, and a port held by another listener.
3. Keep the prior catalog and running Caddy configuration when render or reload fails.
4. With portless access enabled, confirm the installed PF anchor exactly matches the configured Caddy port before reporting the feature active.
5. Verify a mismatched anchor reports **Repair Portless Access** and never turns healthy SSH processes into a tunnel-liveness failure.

Build without installing:

```bash
proxy_on >/dev/null 2>&1
cd desktop
npm run dmg
```

Verify the artifact before replacing the installed App:

```bash
proxy_on >/dev/null 2>&1
shasum -a 256 desktop/dist/Local-Ops-<version>-arm64.dmg
hdiutil verify desktop/dist/Local-Ops-<version>-arm64.dmg
codesign --verify --deep --strict 'desktop/dist/mac-arm64/Local Ops.app'
```

After installation, compare the packaged, installed, and repository health logic:

```bash
proxy_on >/dev/null 2>&1
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  '/Applications/Local Ops.app/Contents/Info.plist'
shasum -a 256 \
  src/tunnel-health.mjs \
  '/Applications/Local Ops.app/Contents/Resources/local-ops/src/tunnel-health.mjs' \
  "$HOME/.local/share/local-ops/src/tunnel-health.mjs"
```

Before an upgrade, record all managed SSH PIDs and listeners. Current backend replacement restarts the control plane and may restart Process Compose worker SSH processes; schedule the operation after active transfers finish and report every PID change.

## 7. Runtime acceptance

For each representative tunnel, capture:

- Process Compose state and actual `/usr/bin/ssh` PID;
- listener ownership from `lsof`;
- SSH-host network result;
- tunnel health status and response code;
- complete domain-entry readiness and response code;
- empty error text after recovery.
- lifecycle desired state and latest audited stop source when applicable.

Include at least:

- one normal `200` domain entry;
- one slow authentication-protected entry returning `401` or `403`;
- one private Git HTTP read and one read-only `git ls-remote`;
- one terminal-failure-to-recovery scenario in isolated tests.

The release passes only when the API/UI state agrees with real listeners and HTTP responses.

## 8. Documentation and publication

Before committing:

1. Update `CHANGELOG.md`, release notes, both READMEs, both user guides, and [Authoritative Project Status](PROJECT_STATUS.md).
2. Keep public and private baselines separate.
3. Check that no real host, username, private key, token, catalog, runtime log, or secret entered the diff.
4. Run `git diff --check` and review the complete diff.
5. Push only the explicitly intended remote.
6. Verify the resulting remote ref with `git ls-remote`.

Record unresolved issues rather than silently presenting them as shipped or fixed.
