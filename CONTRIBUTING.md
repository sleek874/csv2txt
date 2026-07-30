# Contributing

Thank you for helping improve CSV to Fixed-Width Big5 Converter.

## Before implementation

Read the [design specification](docs/DESIGN.md). Changes to encoding, byte
widths, defaults, required fields, privacy behavior, or output bytes must
update the design and tests in the same pull request.

The 15 preset widths and fixed labels are documented in `docs/DESIGN.md`. Use
only synthetic fixtures. An external-system compatibility fixture may be added
only after the repository owner supplies and approves a sanitized source/output
pair; never derive one from production data on your own.

## Local setup

Requirements:

- Node.js 24.18.0 (pinned in `.nvmrc`)
- npm 11.16.x

```bash
nvm use
npm ci --ignore-scripts
npm run dev
```

Before opening a pull request:

```bash
npm run verify
```

`npm run verify` runs the Node test suite, TypeScript check, production build,
and static build-contract verifier. Run `npm run generate:testdata` only when
intentionally regenerating all six synthetic CSV/XLS/XLSX fixtures, then review
the resulting fixture diff.

Use `npm install` only when intentionally adding or updating dependencies, and
commit the resulting `package-lock.json` change with `package.json`.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add synthetic tests for conversion logic and regressions.
- Never commit real or sensitive CSV/TXT data.
- Include byte-level expected output for Big5 conversion changes.
- Update documentation when settings or the output contract changes.
- Verify that no runtime dependency sends network requests or telemetry.

## Issues

Use the issue templates where possible. Security vulnerabilities or accidental
exposure of sensitive fixtures must follow [SECURITY.md](SECURITY.md), not a
public issue.

## Licensing

No project license has been selected. Contributions should not be accepted from
third parties until the repository owner chooses and documents a license and
contribution policy.
