# CSV to Fixed-Width Big5 Converter

[![CI](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml)

A privacy-first browser application for converting 15-column CSV files into
fixed-width Big5 text. File reading, validation, conversion, and download
generation are designed to happen entirely in the browser; source data is not
uploaded to a server.

**[Open the live application](https://sleek874.github.io/csv2txt/)**

> **Current status:** Traditional Chinese UI prototype. Settings can be edited
> and saved locally, but CSV parsing, validation, conversion, and download are
> not implemented yet.

## Planned behavior

- Accept UTF-8, UTF-16, and Big5 CSV input.
- Treat the source as exactly 15 positional fields with no header row.
- Apply configurable defaults, required rules, and Big5 byte widths.
- Preserve source text and visibly flag suspicious whitespace.
- Reject overflow and characters that cannot be represented safely in Big5.
- Produce fixed-width Big5 records separated by CRLF, including a final CRLF.
- Keep uploaded and generated data in browser memory only.

The complete requirements, architecture, conversion rules, test strategy, and
acceptance criteria are maintained in the
**[design specification](docs/DESIGN.md)**.

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer

Install dependencies and start the Vite development server:

```bash
npm ci
npm run dev
```

Vite normally serves the application at <http://localhost:5173>.

Type-check and create a production build:

```bash
npm run check
npm run build
npm run preview
```

The production files are written to `dist/`. Use `npm install` only when
intentionally adding or updating dependencies, and commit changes to both
`package.json` and `package-lock.json`.

## Synthetic test data

The repository includes fictional Traditional Chinese names, addresses, and
identifiers for local testing. No real personal or production data is included.

```bash
npm run generate:testdata
```

See [tests/fixtures/README.md](tests/fixtures/README.md) for fixture details and
intentional invalid cases.

## Deployment

Pushes to `main` trigger GitHub Actions to install dependencies, build the Vite
application, upload `dist/`, and deploy it to GitHub Pages. The repository's
Pages source must be set to **GitHub Actions** under **Settings → Pages**.

The deployed site is available at <https://sleek874.github.io/csv2txt/>.

## Project documents

- [Design specification](docs/DESIGN.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Synthetic fixture guide](tests/fixtures/README.md)

No project license has been selected yet.
