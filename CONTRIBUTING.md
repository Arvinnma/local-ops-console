# Contributing to Local Ops

Thanks for helping improve Local Ops. Bug reports, focused feature proposals, documentation fixes, and pull requests are welcome.

## Before opening an issue

- Search existing issues and the troubleshooting section in `docs/USER_GUIDE.md`.
- Remove private hostnames, usernames, key paths, tokens, and command output from screenshots or logs.
- Include the Local Ops version, macOS version, Mac architecture, reproduction steps, expected result, and actual result.

## Development setup

```bash
brew install node caddy
brew install f1bonacc1/tap/process-compose
npm install
npm test
npm run check
```

Electron development and DMG packaging are documented in `docs/DEVELOPMENT.md`.

## Pull requests

1. Keep each pull request focused on one problem.
2. Add or update tests for configuration, validation, or API behavior.
3. Run `npm test` and `npm run check`.
4. Update the English and Chinese documentation when user-facing behavior changes.
5. Preserve the local-only security model described in `SECURITY.md`.

Never commit `config/catalog.json`, `config/process-compose.token`, `.env` files, private keys, runtime logs, generated configuration, Electron bundles, or DMGs.

## UI conventions

- Use the existing light palette, spacing tokens, icons, and compact action-menu pattern.
- Keep one obvious primary action; place secondary and destructive actions in the overflow menu.
- Make tables horizontally scrollable at narrow widths.
- Include accessible names, keyboard focus, and English translations for new copy.
- Respect reduced-motion settings and avoid unnecessary animation.
