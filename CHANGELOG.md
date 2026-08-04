# Changelog

All notable changes to StatusCode are documented in this file. The project follows Semantic Versioning.

## [Unreleased]

## [1.0.0] - 2026-08-04

### Added

- Toolbar HTTP status indicator for top-level Firefox navigations
- Response-class colors, status-title tooltips, and theme-aware SVG icons
- Redirect, cache, back-forward cache, service worker, and background-suspension handling
- Navigation Timing fallback when a request event does not provide a status
- One-click access to the MDN HTTP status reference
- Session restoration using local SHA-256 URL hashes without persistent raw URLs
- Deterministic extension and source archives with strict file allowlists
- Automated tests, coverage gates, ESLint security rules, Mozilla add-on linting, CI, CodeQL, and Dependabot

### Security

- Private browsing is explicitly disabled
- Noncommitted downloads and prerendered documents cannot overwrite the active tab indicator
- Runtime packages contain no remote code or development files

[Unreleased]: https://github.com/algkmn/status-code/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/algkmn/status-code/releases/tag/v1.0.0
