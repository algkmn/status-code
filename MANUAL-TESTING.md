# Manual Firefox Test Plan

Run this checklist from a clean desktop Firefox profile before submitting version 1.0.0 to Firefox Add-ons.

## Test Environment

Record the operating system, Firefox version, extension commit SHA, extension ZIP SHA-256, and test date. Test the current Firefox Release and another supported desktop Firefox channel at or above version 142.

Build and load the staged extension:

```sh
npm ci --ignore-scripts
npm run verify
```

Open `about:debugging`, select **This Firefox**, load `build/extension/manifest.json`, and keep the extension console open for unexpected errors.

## Acceptance Checklist

| Area | Procedure | Expected result |
| --- | --- | --- |
| Waiting state | Start a slow top-level navigation | The icon shows a neutral ellipsis until a result is known |
| Success | Open an endpoint returning 200 or 204 | The correct code appears with green lines and the correct tooltip |
| Redirect | Open a 301 or 302 endpoint that redirects to 200 | The final committed response becomes authoritative without reverting to pending |
| Client error | Open an endpoint returning 404 or 429 | The correct code appears with red lines and current terminology |
| Server error | Open an endpoint returning 500 or 503 | The correct code appears with orange lines |
| Network failure | Navigate to an unreachable HTTP host | `ERR` appears only when no HTTP response was received |
| Fragment navigation | Change only the URL fragment | The current status remains unchanged |
| History API | Use an SPA that calls `pushState` and `replaceState` | Same-document updates preserve the current status |
| Back-forward cache | Navigate across two pages and use Back and Forward | Each restored document shows its previous status |
| Cache | Reload a cacheable page normally and with a forced refresh | The indicator remains correct for cached and fresh responses |
| Service worker | Test a controlled page served from a service worker | Navigation Timing fallback restores the observable navigation status |
| Download | Click a direct file download that does not replace the tab | The original page status remains visible |
| Failed download | Trigger a failed download or canceled noncommitted request | The original page status remains visible |
| Multiple tabs | Navigate several tabs to different status endpoints | Each tab keeps its own code and tooltip |
| Rapid navigation | Start several navigations in quick succession | An older request never overwrites the newest committed page |
| Background restart | Inspect the extension in `about:debugging`, terminate or reload its background context, then reactivate the tab | The correct icon is restored without a new request |
| Light theme | Use a light Firefox toolbar theme | Status text is black and class lines remain distinct |
| Dark theme | Use a dark Firefox toolbar theme | Status text is white and class lines remain distinct |
| Toolbar click | Click the StatusCode icon | MDN's HTTP status reference opens in a new tab |
| Non-HTTP pages | Open `about:blank`, `about:addons`, and a local Firefox page | No stale HTTP status is presented as the current page result |
| Private browsing | Open a private window and inspect extension access | StatusCode is unavailable because private browsing is disallowed |
| Permission removal | Disable site access or the extension | Firefox prevents observation without errors or unwanted network activity |

Suggested public endpoints for basic response checks include `https://httpstat.us/200`, `/301`, `/404`, and `/500`. Treat an endpoint outage as a test-environment failure rather than an extension failure.

## Privacy Inspection

From the extension toolbox, inspect `browser.storage.session` after visiting a URL containing a distinctive query value. Confirm that no raw hostname, path, query key, or query value is present. Stored URL identifiers must be 64-character lowercase SHA-256 hashes. Close the tab and confirm both per-tab storage keys are removed.

Monitor the Network panel while idle. StatusCode must not initiate any request. The only extension-triggered external navigation should occur after clicking the toolbar icon.

## Package Inspection

Open `dist/statuscode-1.0.0.zip` and confirm it contains only `manifest.json`, runtime JavaScript, the full MPL license, the extension icon, and generated status SVGs. It must not contain source assets, tests, repository metadata, logs, environment files, package manifests, or symbolic links.

## Exit Criteria

- Every checklist item passes on both supported Firefox channels.
- The extension console has no uncaught errors.
- `npm run verify` succeeds from a clean dependency install.
- `npm audit --audit-level=high` reports zero vulnerabilities.
- Any exception is documented with reproduction steps and release impact before submission.
