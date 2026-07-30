# CSV / Excel to Fixed-Width Big5 Converter

[![CI](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml)

A privacy-first browser application for converting CSV, XLS, and XLSX files with
a default 15-column profile into fixed-width Big5 text. File reading, validation,
conversion, and download generation happen entirely in the browser; source data
is not uploaded to a server.

**[Open the live application](https://sleek874.github.io/csv2txt/)**

## Current behavior

- Accepts only `.csv`, `.xls`, and `.xlsx` filenames and selects the parser from
  the filename extension.
- Accepts UTF-8, UTF-16, and Big5 CSV input as raw bytes.
- Reads the first XLS/XLSX worksheet and converts formatted cell display values
  directly to the common row model. Missing cells become empty strings, and
  locale-sensitive built-in dates use the deterministic `yyyy/mm/dd` fallback.
- Uses saved formula results; formulas without a cached result block conversion.
- Currently treats the source as the default 15 positional fields with no header
  row; a variable-length field editor is planned separately.
- Applies the selected source-whitespace policy before defaults and required
  checks. Whitespace is removed by default; preserved whitespace is marked in
  preview.
- Applies configurable defaults, required rules, alignment, and Big5 byte widths.
- Rejects malformed CSV, wrong record/column counts, overflow, control characters,
  and text that cannot round-trip safely through Big5.
- Produces fixed-width Big5 records separated by CRLF, including a final CRLF.
- Keeps selected and generated data in browser memory only. The current converter
  version 3 settings are transparently auto-saved to browser storage and restored
  on the next visit; the last complete valid settings also remain available in
  memory for recovery or download while an edit is invalid. Explicit settings-file
  upload/download provides a portable JSON backup, and invalid settings files are
  rejected with a specific dialog before they can replace active settings. Source
  data, previews, generated output, and the per-file CSV encoding choice are never
  included in either settings store.
- Precaches the production application after the first online load. Once the
  header reports `已可離線使用`, conversion and later reloads work without an
  internet connection. Browser refresh controls retain their normal behavior and
  show the browser's standard leave-page warning only when a source file is held
  in memory. Updates are downloaded quietly into a complete versioned cache and
  take effect after tabs using the previous version have closed. Excel parsing
  code and the preview font are prepared after the base interface: CSV use
  promotes the font, Excel use loads its parser before the font, and unattended
  idle preparation keeps the deterministic Excel-then-font order. Optional
  resources are reused across later visits. Vite's generated manifest is the
  canonical resource graph for these cache groups and application versions.
- Refuses to initialize inside an iframe and instead offers a direct-open link.
  This runtime guard mitigates clickjacking on GitHub Pages, which cannot emit a
  header-delivered `frame-ancestors` policy.
- Exposes semantic 0–4 workflow sections, concise live statuses, table
  captions, connected control help, and crawler/agent discovery metadata.
- Uses a shared responsive visual system for light and dark themes. File,
  settings, validation, and readiness states reserve stable layout space and
  retain keyboard-accessible scrolling where fixed-width relationships cannot
  be compressed safely.

The complete requirements, architecture, conversion rules, test strategy, and
acceptance criteria are maintained in the
**[design specification](docs/DESIGN.md)**.

## Development

Requirements:

- Node.js 24.18.0 (the version pinned in `.nvmrc`)
- npm 11.16.x

Install dependencies and start the Vite development server:

```bash
nvm use
npm ci --ignore-scripts
npm run dev
```

Vite normally serves the application at <http://localhost:5173>.

Run the complete local verification:

```bash
npm run verify
```

Individual checks remain available when diagnosing a failure:

```bash
npm run check
npm test
npm run build
npm run preview
```

The production files are written to `dist/`. Use `npm install` only when
intentionally adding or updating dependencies, and commit changes to both
`package.json` and `package-lock.json`.
The build verifier checks that the service worker's base, Excel, and font groups
exactly match `dist/.vite/manifest.json`.

This repository disables dependency lifecycle scripts by default in `.npmrc`.
Only override that setting for a reviewed dependency that explicitly requires an
installation script.

## Synthetic test data

The repository includes fictional Traditional Chinese names, addresses, and
identifiers for local testing. No real personal or production data is included.

```bash
npm run generate:testdata
```

See [tests/fixtures/README.md](tests/fixtures/README.md) for fixture details and
intentional invalid cases.

## Deployment

Pushes to `main` trigger GitHub Actions to install dependencies, run the test
suite and verified Vite build, upload `dist/`, and deploy it to GitHub Pages.
The repository's Pages source must be set to **GitHub Actions** under
**Settings → Pages**.

The deployed site is available at <https://sleek874.github.io/csv2txt/>.

## Project documents

- [Design specification](docs/DESIGN.md)
- [Site-wide implementation review](docs/SITE_REVIEW.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Agent-readable overview](public/llms.txt)
- [Synthetic fixture guide](tests/fixtures/README.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

No project license has been selected yet.
