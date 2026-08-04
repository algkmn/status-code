# Build Instructions

These instructions reproduce the Firefox Add-ons upload package and the matching source package from a clean checkout.

## Reference Environment

- Ubuntu 24.04.4 LTS on ARM64
- Node.js 24.14.0
- npm 11.9.0

The exact Node.js version is recorded in `.nvmrc`; the npm version is recorded in `package.json`. No globally installed build tool is required.

## Clean Build

```sh
npm ci --ignore-scripts
npm run verify
```

The command performs all automated tests, enforces coverage thresholds, runs ESLint and Mozilla's add-on linter, stages the runtime allowlist, builds both ZIP files, validates every archive entry and CRC, compares archived files with their sources, and rebuilds each archive in memory to confirm byte-for-byte reproducibility.

Expected artifacts:

- `dist/statuscode-1.0.0.zip`
- `dist/statuscode-1.0.0-source.zip`

## Individual Build Commands

```sh
npm run build
npm run build:source
npm run verify:package
```

`npm run build` removes and recreates `build/extension`, copies only the declared runtime files, and generates 502 static toolbar SVGs. It never archives the repository root.

## Generated Files

The files under `icons/status/` and `build/extension/icons/status/` are generated from:

- `scripts/generate-icons.mjs`
- `assets/fonts/RobotoCondensed[wght].ttf`

Roboto Condensed is used only at build time. Glyphs are converted to SVG path outlines. The font file is not included in the extension upload package.

## Deterministic Archive Rules

- File paths are sorted and deduplicated.
- Only explicit source and runtime allowlists are accepted.
- Symbolic links and other nonregular entries are rejected.
- ZIP timestamps and Unix file modes are normalized.
- Compression level and platform metadata are fixed.
- Absolute paths, backslashes, empty segments, and parent traversal are rejected.

Running the same build from the same source and lockfile produces the same SHA-256 digest.

## Network Access

Dependency installation contacts the npm registry. After `npm ci --ignore-scripts` completes, tests and build steps require no network access. The extension itself performs no background network request.
