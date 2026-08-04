# StatusCode

[![CI](https://github.com/algkmn/status-code/actions/workflows/ci.yml/badge.svg)](https://github.com/algkmn/status-code/actions/workflows/ci.yml)
[![CodeQL](https://github.com/algkmn/status-code/actions/workflows/codeql.yml/badge.svg)](https://github.com/algkmn/status-code/actions/workflows/codeql.yml)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)

A privacy-friendly Firefox extension that displays the current page's HTTP status code directly in the toolbar.

## Features

- Shows the top-level document's HTTP status code without repeating the request
- Uses distinct colors for informational, success, redirect, client-error, and server-error responses
- Shows the standard status title in the toolbar tooltip
- Handles redirects, cached responses, back-forward cache restores, and background suspension
- Prevents downloads and other noncommitted requests from replacing the current page status
- Adapts the icon text to light and dark Firefox themes
- Opens the [MDN HTTP status reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status) when clicked
- Contains no analytics, tracking, remote code, or runtime dependencies

Before a page responds, the icon displays an ellipsis. If the navigation fails before an HTTP response is received, it displays `ERR`.

## Status Colors

| Class | Color | Meaning |
| --- | --- | --- |
| 1xx | `#FFD966` | Informational |
| 2xx | `#70AD47` | Success |
| 3xx | `#A855F7` | Redirection |
| 4xx | `#FF0000` | Client Error |
| 5xx | `#ED7D31` | Server Error |

## How It Works

StatusCode correlates Firefox main-frame `webRequest` events with top-level navigation events. Navigation Timing is used as a fallback when Firefox serves a response without an observable request result. Subresources never replace the displayed status.

Temporary per-tab state is kept in `browser.storage.session` so Firefox can restore the icon after suspending the background context. Raw page URLs are processed only in memory. Persistent session records contain one-way SHA-256 URL hashes, status metadata, and Firefox document identifiers; they never contain raw URLs.

## Permissions

| Permission | Purpose |
| --- | --- |
| `webRequest` | Reads the response status of top-level document requests |
| `webNavigation` | Associates responses with the correct tab and navigation lifecycle |
| `storage` | Restores temporary per-tab display state after background suspension |
| `http://*/*`, `https://*/*` | Enables the indicator on HTTP and HTTPS pages |

The extension does not read request bodies, response bodies, headers, cookies, form values, or general page content. Private browsing is explicitly disabled so no private-window navigation state can be retained by the extension.

See [PRIVACY.md](PRIVACY.md) for the complete data-handling statement.

## Requirements

- Firefox 142 or later on desktop
- Node.js 24.14.0
- npm 11.9.0

## Temporary Installation

```sh
npm ci --ignore-scripts
npm run prepare:extension
```

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Click **Load Temporary Add-on**.
4. Select `build/extension/manifest.json`.

Run `npm run prepare:extension` again and use **Reload** in `about:debugging` after changing source files.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run verify
```

| Command | Purpose |
| --- | --- |
| `npm test` | Runs the complete automated test suite |
| `npm run test:coverage` | Enforces line, branch, and function coverage thresholds |
| `npm run lint` | Runs ESLint security rules and Mozilla's add-on linter |
| `npm run start` | Launches a temporary Firefox development profile with `web-ext` |
| `npm run build` | Creates the deterministic AMO upload ZIP |
| `npm run build:source` | Creates the deterministic AMO source ZIP |
| `npm run verify` | Runs every release gate and verifies both archives |

Generated status icons are intentionally excluded from Git. The build converts the bundled Roboto Condensed font to SVG vector outlines, so the published extension does not load a font or any other remote asset at runtime.

## Release Artifacts

`npm run verify` creates:

- `dist/statuscode-1.0.0.zip`
- `dist/statuscode-1.0.0-source.zip`

Both archives are built from explicit allowlists, use normalized metadata, reject unsafe paths, and are checked for byte-for-byte reproducibility. See [BUILD.md](BUILD.md) for reviewer instructions and [MANUAL-TESTING.md](MANUAL-TESTING.md) for the desktop Firefox acceptance checklist.

## Contributing and Security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

StatusCode is licensed under the [Mozilla Public License 2.0](LICENSE).

Roboto Condensed is licensed under the SIL Open Font License 1.1. Its license is included at [assets/fonts/OFL.txt](assets/fonts/OFL.txt).
