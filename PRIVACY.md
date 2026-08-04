# Privacy Policy

Effective date: August 4, 2026

StatusCode does not collect, transmit, sell, share, or monetize personal data. It has no analytics, advertising, telemetry, account system, remote code, or background network service.

## Data Processed Locally

StatusCode observes the top-level HTTP or HTTPS navigation in the active Firefox tab to display its response status. During that process, Firefox provides the page URL and navigation identifiers to the extension.

Raw page URLs are used only in volatile extension memory to associate browser events. They are never written to extension storage. Temporary `browser.storage.session` records may contain:

- The displayed HTTP status and tooltip state
- Firefox request and document identifiers
- Navigation arbitration identifiers and timestamps
- A one-way SHA-256 hash of the normalized page URL

URL hashes remain local to Firefox and are used only to restore the correct icon after the background context is suspended. A URL hash is not treated as anonymized data; it is simply used to avoid storing the raw URL. Session records are removed when a tab closes and Firefox clears session storage when the browser session ends.

## Data Not Accessed

StatusCode does not read or store request bodies, response bodies, HTTP headers, cookies, form values, passwords, authentication tokens, or general page content.

## Private Browsing

The extension declares `incognito: not_allowed`. Firefox therefore does not run StatusCode in private windows and no private-window navigation state is processed or stored by the extension.

## User-Initiated External Link

Clicking the toolbar icon opens the public MDN HTTP status reference in a new tab. This is an explicit user action. The resulting request is handled by Firefox and MDN under their respective privacy practices.

## Changes

Material changes to this policy will be documented in the repository and released with a new extension version.

## Contact

Questions about this policy can be sent to algkmn@gmail.com or opened at https://github.com/algkmn/status-code/issues.
