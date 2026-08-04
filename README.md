# StatusCode

A privacy-friendly Firefox extension that displays the current page's HTTP status code directly in the toolbar.

## Features

- Shows the main document's HTTP status code at a glance
- Updates automatically after navigation
- Displays the status title in the Firefox tooltip
- Uses distinct colors for HTTP response classes
- Supports redirects, cached responses, service workers, and back-forward cache navigation
- Restores the correct icon after Firefox suspends the background context
- Adapts the status text to light and dark Firefox themes
- Opens the MDN HTTP Status reference when the toolbar icon is clicked
- Makes no additional network request to determine the status code
- Collects no personal data

## Status Colors

| Class | Color | Meaning |
| --- | --- | --- |
| 1xx | `#FFD966` | Informational |
| 2xx | `#70AD47` | Success |
| 3xx | `#A855F7` | Redirection |
| 4xx | `#FF0000` | Client Error |
| 5xx | `#ED7D31` | Server Error |

Before a page responds, the toolbar icon displays an ellipsis. If no HTTP response is received, it displays `ERR`.

## How It Works

StatusCode combines Firefox main-frame request events with the page's Navigation Timing entry. It observes only the top-level document response, so images, scripts, stylesheets, and other subresources cannot replace the displayed status code.

The extension does not repeat the page request. Temporary per-tab state is stored in Firefox session storage so the icon can be restored after navigation or background suspension.

## Permissions

| Permission | Purpose |
| --- | --- |
| `webRequest` | Reads the response status of main document requests |
| `webNavigation` | Associates responses with the correct tab and navigation lifecycle |
| `storage` | Keeps temporary per-tab display state across background suspension |
| `<all_urls>` | Allows the indicator to work on any HTTP or HTTPS page |

StatusCode does not read or modify page content, request bodies, response bodies, headers, cookies, or form data.

## Privacy

StatusCode does not collect, store, sell, or transmit personal data. Temporary display state remains inside Firefox session storage and is removed when the browser session ends.

## Requirements

- Firefox 140 or later
- Node.js 20 or later for development

## Development

```sh
npm install
npm run generate:icons
npm test
npm run lint
npx web-ext run
```

The status icons are generated from the official Roboto Condensed variable font at weight 700. Text is converted to vector outlines during the build, so runtime rendering does not depend on an installed system font.

## Temporary Installation

1. Open `about:debugging` in Firefox.
2. Select **This Firefox**.
3. Click **Load Temporary Add-on**.
4. Select `manifest.json` from this repository.

Use **Reload** on the debugging page after making changes.

## Build

```sh
npm run build
```

The upload-ready Firefox Add-ons package is created in `dist/`.

## License

StatusCode is licensed under the [Mozilla Public License 2.0](LICENSE).

Roboto Condensed is licensed under the SIL Open Font License 1.1. Its license is available at `assets/fonts/OFL.txt`.
