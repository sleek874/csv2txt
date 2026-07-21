# Contributing

Thank you for helping improve CSV to Fixed-Width Big5 Converter.

## Before implementation

Read the design in [README.md](README.md). Changes to encoding, byte widths,
defaults, required fields, privacy behavior, or output bytes must update the
design and tests in the same pull request.

The 15 preset widths and fixed labels are documented in `README.md`. A sanitized
legacy fixture is still required; do not invent production-derived test data.

## Local setup

Requirements:

- Node.js 22 or newer
- npm 10 or newer

```bash
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run check
npm run build
```

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
