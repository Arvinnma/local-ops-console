# Development and Release Guide

## Prerequisites

- Apple Silicon macOS host
- Node.js 22.12 or newer and npm
- Caddy in `PATH`
- Process Compose in `PATH`

```bash
brew install node caddy
brew install f1bonacc1/tap/process-compose
```

## Repository layout

```text
public/       Browser UI and local icon library
src/          Configuration, orchestration, Docker, and HTTP APIs
scripts/      Rendering, installation, control, and lifecycle scripts
desktop/      Electron shell and electron-builder configuration
config/       Safe example catalog; real catalog is ignored
launchd/      LaunchAgent templates
tests/        Node test suite
```

Runtime data is written to `~/.local/share/local-ops` after installation. Do not develop against a committed real catalog.

## Validate changes

```bash
npm install
npm run check
npm test
```

For UI changes, test both Simplified Chinese and English, keyboard focus, narrow-window horizontal scrolling, menus, dialogs, and reduced-motion behavior.

## Local backend installation

```bash
./scripts/install.zsh
```

This source-development installer uses Homebrew dependencies and registers the local LaunchAgent. Normal DMG users do not run this script.

## Electron development

```bash
cd desktop
npm install
npm start
```

## Build the DMG

```bash
cd desktop
npm run dmg
```

The bundle step copies the backend source, Caddy binary, and Process Compose binary into `desktop/bundle/local-ops`. Electron Builder produces an Apple Silicon DMG under `desktop/dist`.

To build, install, sign ad hoc, and launch the app in one command:

```bash
./scripts/build-app.zsh
```

## Version checklist

1. Update the root and desktop package versions plus lockfiles.
2. Update asset cache versions in `public/index.html` and `public/app.js`.
3. Add release notes to `CHANGELOG.md` and `docs/releases/`.
4. Run syntax checks and tests.
5. Build the DMG and verify its architecture, signature, bundled component versions, and first-launch upgrade path.
6. Verify the installed app in Chinese and English without starting or stopping unrelated user resources.
7. Tag the commit and attach the DMG to a GitHub Release.

Public distribution should replace ad-hoc signing with Apple Developer ID signing, Hardened Runtime, entitlements, and notarization.
