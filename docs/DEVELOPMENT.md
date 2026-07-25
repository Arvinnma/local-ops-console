# Development and Release Guide

## Supported build target

Local Ops v1.8.2 ships an Apple Silicon (`arm64`) macOS package. Intel (`x64`) and universal packages are not part of the current release matrix.

Before describing a change as released, check [Authoritative Project Status](PROJECT_STATUS.md). It records the installed build, public GitHub/tag/artifact baseline, and private Forgejo/runtime baseline separately. A private post-release hotfix is not part of an older public tag merely because its App bundle still carries the same version number.

## Prerequisites

- Apple Silicon Mac running macOS 12 or newer
- Node.js 22.12 or newer and npm
- Caddy in `PATH`
- Process Compose in `PATH`
- Xcode Command Line Tools for the native Keychain helper
- Docker Desktop only for the optional Docker lifecycle test

```bash
brew install node caddy
brew install f1bonacc1/tap/process-compose
```

## Repository layout

```text
assets/       Canonical vector brand sources
public/       Browser UI, translations, and icon library
src/          Configuration, Keychain integration, orchestration, Docker, and HTTP APIs
scripts/      Rendering, installation, native-helper build, control, and lifecycle scripts
desktop/      Electron shell, menu-bar panel, portless helper assets, and packaging config
native/       Security.framework Keychain helper source
config/       Safe example catalog; real catalog is ignored
launchd/      Per-user LaunchAgent template
tests/        Unit, localization, Keychain, and end-to-end smoke tests
docs/         User, development, and release documentation
```

Installed runtime data lives under `~/.local/share/local-ops`. Never copy a real catalog, token, session file, private key, or runtime log into the repository.

## Install dependencies

```bash
npm ci
cd desktop
npm ci
cd ..
```

## Development checks

```bash
npm run check
npm test
npm run build:keychain
npm run test:keychain
```

`npm test` covers configuration normalization, route paths, loopback validation, portable migration, legacy startup migration, AppleScript compilation, and English-copy coverage. `npm run test:keychain` creates a temporary encrypted Ed25519 key, verifies that a wrong passphrase fails, and then unlocks it through the Local Ops Keychain/AskPass path. Temporary keys and Keychain items are removed in `finally` cleanup.

For an installed backend smoke test:

```bash
./scripts/install.zsh
npm run test:smoke
```

The smoke test creates uniquely named temporary resources, exercises security headers and mutation guards, starts/restarts/stops a command service, checks logs and ordering, validates a tunnel definition, proxies a real path through Caddy, checks terminal configuration and export scope, then removes every temporary resource.

To include a dedicated temporary Docker container lifecycle without touching existing containers:

```bash
LOCAL_OPS_TEST_DOCKER_MUTATIONS=1 npm run test:smoke
```

## Browser and accessibility QA

Test both Simplified Chinese and English at desktop and 720 px minimum window widths:

- all seven views and responsive table scrolling;
- Needs Attention details and jump links;
- add/edit dialogs, icon selection, required-field validation, and toast stacking;
- primary start/stop actions, overflow-menu keyboard navigation, and hidden unsupported actions;
- optimistic drag ordering;
- configuration export/import warnings;
- reduced-motion mode, focus visibility, and accessible names.

Do not change real user resources for visual QA. Use temporary smoke-test IDs or a disposable catalog.

With the installed backend running and Google Chrome available, the automated browser gate verifies strict-CSP rendering, generated icon colors, anchored overflow menus, and narrow-table scrolling:

```bash
npm run test:browser
```

## Electron development

```bash
cd desktop
npm start
```

The Electron renderer is sandboxed, has no Node integration, denies permission requests, and restricts navigation to bundled files and local HTTP(S) addresses. The menu-bar panel uses `tray.html`, `tray.css`, and `tray.js` with the same constrained preload bridge.

## Build the native assets and DMG

```bash
cd desktop
npm run icon
npm run bundle
npm run dmg
```

The bundle step:

1. copies safe backend source and the example catalog;
2. copies arm64 Caddy and Process Compose binaries from `PATH`;
3. compiles the arm64 Security.framework Keychain helper;
4. writes a bundle manifest containing versions and architecture;
5. packages an ad-hoc-signed Electron app and DMG.

Output:

```text
desktop/dist/mac-arm64/Local Ops.app
desktop/dist/Local-Ops-1.8.2-arm64.dmg
```

To build, replace the app in Applications, re-sign ad hoc, verify the signature, and launch it:

```bash
./scripts/build-app.zsh
```

## Release gate

The command-by-command gate, cold-start matrix, SSH/TCP liveness versus HTTP readiness semantics, desired-state/stop-audit checks, `401/403` domain-entry handling, installation checks, and result template live in [Release and Hotfix Regression Manual](RELEASE_REGRESSION.md). The summary below does not replace that checklist.

1. Establish and record the intended public and private baselines in [Authoritative Project Status](PROJECT_STATUS.md).
2. Update root/desktop versions, lockfiles, cache query strings, changelog, issue template, READMEs, user guides, and release notes.
3. Run `npm audit --omit=dev`, the desktop production audit, and the full desktop audit.
4. Run syntax checks, unit tests, Keychain integration, installed smoke, automated browser QA, and optional Docker mutation smoke.
5. Run Gitleaks against both Git history and the full working tree with redaction enabled.
6. Build the DMG and verify:
   - `arm64` for the app executable, Caddy, Process Compose, and Keychain helper;
   - valid deep ad-hoc signature;
   - expected bundle identifier and version;
   - no real catalog, token, last-session file, `.env`, private key, or logs in the app/DMG;
   - mounted DMG layout/signature and installed-app launch;
   - upgrade preserves an existing user catalog.
7. Re-run browser and menu-bar QA from the packaged app in Chinese and English.
8. Generate the SHA-256 checksum and add it to the current file under `docs/releases/`.
9. Commit and push only after the secret audit passes; verify the intended remote ref rather than assuming every remote should advance.
10. Create a signed Git tag for the current version when possible and publish the GitHub Release with the arm64 DMG and checksum.

Public distribution should eventually replace ad-hoc signing with Apple Developer ID signing, Hardened Runtime, entitlements, and notarization.

## Secret and artifact hygiene

The following must remain ignored and absent from all commits and release bundles:

- `config/catalog.json`, `config/last-session.json`, and `config/process-compose.token`;
- `.env*`, private keys, certificates, and provisioning files;
- `runtime/`, generated runtime YAML/Caddy files, app bundles, DMGs, and dependency directories;
- screenshots or docs containing private hosts, usernames, paths, tokens, or logs.

If a credential ever enters Git history, rotate it first and rewrite the history before making the repository public.
