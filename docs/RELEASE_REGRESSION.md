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
git rev-parse 'v1.8.2^{}'
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

## 3. Cold-start and network-readiness regression

Use a disposable tunnel or isolated catalog. Do not disconnect a production transfer merely to exercise this gate.

Verify:

1. `ssh -G <alias>` resolves the effective host and port used by the network gate.
2. With the SSH endpoint unavailable, the card says **Connecting / Waiting for Network** and never **Connected**.
3. There is no fixed long startup sleep.
4. Each SSH attempt contains `ConnectTimeout=5` and `ConnectionAttempts=1`.
5. Process Compose starts the next round at roughly three-second intervals.
6. A user-triggered start stops after 3 failed attempts.
7. Previous-session restoration allows 40 attempts.
8. When the endpoint becomes reachable, the next retry connects without manual intervention.
9. Only one SSH process owns the configured local listener.
10. Stopping the tunnel removes both the SSH process and listener.

## 4. HTTP readiness matrix

Tunnel health and complete domain-entry readiness intentionally use different status policies:

| Probe | Ready responses | Not ready | Timeout |
| --- | --- | --- | --- |
| Tunnel HTTP health URL | HTTP `100–499` | `5xx`, connection/DNS failure | 10 seconds |
| Complete `.localhost` domain entry | `2xx`, `3xx`, `401`, `403` | `404`, other `4xx`, `5xx`, connection/DNS failure | 10 seconds |

Important interpretation:

- `401 Unauthorized` and `403 Forbidden` are successful **readiness** results only for the complete domain entry. They prove that Caddy, the SSH forward, and the authentication-protected service answered.
- They do not prove that credentials are valid or that the user can complete a login.
- `404` remains a failure because it commonly indicates an incorrect protected entry path.
- A local TCP listener alone is insufficient evidence that the remote application is usable.

Regression cases:

1. Delay protected responses for more than two seconds but less than ten seconds; `401` and `403` must still become ready.
2. Fail a domain entry until its retry budget is exhausted; it may show the terminal failure between probes.
3. Restore the entry and wait for the 30-second recovery interval; the same running SSH process must return to **Connected**.
4. Confirm that repeated UI refreshes inside the interval do not create high-frequency HTTP probes.
5. Confirm that a domain-only failure does not restart a healthy SSH process.

## 5. Package and installed-runtime verification

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

## 6. Runtime acceptance

For each representative tunnel, capture:

- Process Compose state and actual `/usr/bin/ssh` PID;
- listener ownership from `lsof`;
- SSH-host network result;
- tunnel health status and response code;
- complete domain-entry readiness and response code;
- empty error text after recovery.

Include at least:

- one normal `200` domain entry;
- one slow authentication-protected entry returning `401` or `403`;
- one private Git HTTP read and one read-only `git ls-remote`;
- one terminal-failure-to-recovery scenario in isolated tests.

The release passes only when the API/UI state agrees with real listeners and HTTP responses.

## 7. Documentation and publication

Before committing:

1. Update `CHANGELOG.md`, release notes, both READMEs, both user guides, and [Authoritative Project Status](PROJECT_STATUS.md).
2. Keep public and private baselines separate.
3. Check that no real host, username, private key, token, catalog, runtime log, or secret entered the diff.
4. Run `git diff --check` and review the complete diff.
5. Push only the explicitly intended remote.
6. Verify the resulting remote ref with `git ls-remote`.

Record unresolved issues rather than silently presenting them as shipped or fixed.
