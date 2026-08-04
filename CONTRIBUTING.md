# Contributing

Thank you for helping improve StatusCode.

## Before You Start

- Use Node.js 24.14.0 and npm 11.9.0.
- Search existing issues before opening a new one.
- Report vulnerabilities privately according to `SECURITY.md`.
- Follow `CODE_OF_CONDUCT.md` in all project spaces.

## Setup

```sh
npm ci --ignore-scripts
npm run verify
```

Generated files under `icons/status/`, `build/`, and `dist/` are not committed. Update the generator or source assets instead.

## Pull Requests

Keep each pull request focused. Explain the behavior change, its motivation, security or privacy impact, and how it was tested. Add or update automated tests for every behavior change and update user-facing documentation when necessary.

Before submitting:

```sh
npm run verify
```

Pull requests must pass CI, CodeQL, Mozilla add-on linting, coverage thresholds, package-content verification, and deterministic-build checks.

By contributing, you agree that your contribution is licensed under the Mozilla Public License 2.0.
