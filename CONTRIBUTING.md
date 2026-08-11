# Contributing

Thank you for helping improve Offline Data Conversion.

## Engineering principles

Optimize for code that a human can understand and verify. These are judgment
guidelines, not mechanical limits on function length or file count:

- Treat current requirements as the contract. Remove obsolete paths instead of
  adding compatibility layers, fallbacks, or migrations unless compatibility is
  an explicit requirement.
- Choose the simplest end-to-end implementation that meets the contract. Avoid
  speculative abstractions, configuration, indirection, and extension points.
- Grow the product in working vertical increments. Each increment must leave the
  existing conversion workflow usable and verified.
- Keep modules cohesive and concerns clearly separated, but preserve useful
  locality; do not split straightforward logic into trivial wrappers.
- Prefer intention-revealing names, focused responsibilities, simple control
  flow, and comments that explain why. Remove duplicated knowledge, but do not
  force unrelated code behind a premature abstraction.
- Reuse platform features and existing dependencies first. Check their
  documentation and types before writing replacements; add a maintained library
  only when it reduces total complexity or improves reliability.
- Make durable architectural decisions. Do not introduce a knowingly temporary
  path that is expected to be replaced later.

For project-specific ownership boundaries, dependency requirements, and the
fresh-start policy, see [the architecture guide](docs/ARCHITECTURE.md).

## Working with coding agents

- State the intended outcome, constraints, invariants, and allowed behavior
  changes. Keep requirements separate from a proposed implementation.
- For non-obvious or architectural work, ask for analysis and trade-offs before
  mutation; the repository owner chooses the direction.
- Prefer small, focused, reviewable patches. Treat generated code as untrusted
  until tests, static checks, runtime evidence, and diff review support it.
- Require facts, deductions, and assumptions to be distinguishable. Preserve
  error semantics, ordering, output bytes, and public behavior unless the task
  explicitly changes them.

Use this sequence when the change is not trivial:

```text
intent -> constraints and invariants -> analysis -> alternatives and trade-offs
       -> chosen direction -> minimal implementation -> verification -> diff review
```

## Before implementation

Read the [design specification](docs/DESIGN.md). Changes to encoding, byte
widths, defaults, required fields, privacy behavior, or output bytes must
update the design and tests in the same pull request.

Before a major update, document and agree on the intended outcome, invariants,
allowed behavior changes, ownership boundaries, first working increment, and
verification evidence. Update the design, architecture, and roadmap according
to their documented ownership before broad implementation begins.

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
intentionally regenerating the complete synthetic dataset, then review the
resulting fixture diff and preserve CSV/TXT CRLF bytes.

`src/core/big5e-mapping.ts` and `src/core/private-use-recovery-mapping.ts` are
generated artifacts. Regenerate them only from the pinned official archive
documented in `docs/BIG5E_MAPPING.md`, using its recorded SHA-256:

```bash
npm run generate:big5e-mapping -- /path/to/MapingTables.zip
```

Use `npm install` only when intentionally adding or updating dependencies, and
commit the resulting `package-lock.json` change with `package.json`.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add synthetic tests for conversion logic and regressions.
- Never commit real or sensitive CSV/TXT data.
- Include byte-level expected output and official mapping provenance for BIG-5E conversion changes.
- Update documentation when the fixed profile, validation, or output contract changes.
- Verify that no runtime dependency sends network requests or telemetry.

## Issues

Use the issue templates where possible. Security vulnerabilities or accidental
exposure of sensitive fixtures must follow [SECURITY.md](SECURITY.md), not a
public issue.

## Licensing

No project license has been selected. Contributions should not be accepted from
third parties until the repository owner chooses and documents a license and
contribution policy.
