# Local Ops brand assets

`local-ops-app-icon-1024.svg` is the canonical 1024 × 1024 vector source for the macOS app icon. The other SVG files are derived variants for product UI and the macOS menu bar.

- `local-ops-app-icon-1024.svg`: master app icon, including the green rounded-square container.
- `local-ops-mark.svg`: standalone green logo mark for light surfaces.
- `local-ops-tray-template.svg`: simplified monochrome template for the macOS menu bar.

Run `cd desktop && npm run icon` after changing these files. The command regenerates the 1024 × 1024 PNG, `.icns`, public web assets, and 1×/2× menu-bar PNGs from the vector sources.
