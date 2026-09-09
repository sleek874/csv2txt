# Test system

The repository separates evidence by the behavior it can actually prove. A passing label helper is not counted as rendered-browser coverage, and Lighthouse is not counted as conversion correctness.

## Evidence scopes

| Scope | Ownership | Command |
| --- | --- | --- |
| Unit | One production module with deterministic collaborators; parsing, normalization, validation, mappings, selectors, preferences, compact state and browser-resource policy | `npm run test:unit` |
| Application | Multi-module state machines; controllers, worker client/engine, archive traversal, output generation and cancellation | `npm run test:application` |
| Contract | Repository fixture parity, boundary archives and test-system classification | `npm run test:contract` |
| Presentation | Pure labels and presentation projections only; no claims about layout, focus or interaction | `npm run test:presentation` |
| Browser | Production build in isolated WSL Chrome; real fixture upload, conversion readiness, download, desktop/narrow layout, reduced motion and browser errors | `npm run test:browser` |
| Audit | Lighthouse page-load, static accessibility, best-practice, SEO and agent-discovery scoring | `npm run audit:lighthouse` |
| Static build | Generated shell, ARIA references, CSP, release graph, resource groups, budgets and obsolete residue | `npm run verify:build` |

`tests/test-scopes.mjs` is the owning Node-test manifest. `tests/test-system.test.mjs` fails when a `*.test.mjs` file is missing from the manifest or appears in more than one scope. Pure presentation helpers share `tests/presentation-contracts.test.mjs`; larger engine and controller suites stay separate because they own different state machines.

## Coverage

`npm run test:coverage` runs all Node scopes through c8 with `all: true`. Therefore an unimported file inside the declared critical scope is counted as zero instead of disappearing from the denominator.

The measured scope includes core conversion logic, adapters, batch state, resources, workspace state, section controllers, advanced preferences and offline-cache policy. It excludes:

- Type-only protocol/model files, which emit no runtime behavior.
- Generated BIG-5E and PUA lookup tables; their provenance, range and round-trip invariants remain directly tested.
- DOM view renderers, bootstrap and worker entrypoints; browser/static scopes own those behaviors.

The gate requires at least:

- Global: 90% statements/lines, 80% branches and 85% functions.
- Every included file: 70% statements/lines, 60% branches and 60% functions.

Reports are generated under ignored `coverage/unit/`. Thresholds should move only after meaningful tests; imports, ignore comments and implementation-only assertions are not acceptable ways to raise a percentage.

## Browser and Lighthouse workflow

Build first, then use the installed Linux `google-chrome` executable. Both scripts start the production preview at `http://127.0.0.1:4173/`, create a fresh profile under `/tmp`, avoid `--no-sandbox`, and clean the temporary profile afterward.

```bash
npm run build
npm run test:browser
npm run audit:lighthouse
```

The browser smoke uploads `testdata/csv/clean-single.csv`, waits for worker processing, asserts one selected output row, downloads the generated TXT, checks overall page overflow at 1280×900 and 390×844, emulates reduced motion, and fails on console errors, page exceptions or HTTP errors. Its screenshot and JSON summary are written to ignored `reports/browser/`.

Lighthouse writes ignored `reports/lighthouse/report.html`, `report.json` and `summary.md`. Initial regression floors are Performance 80, Accessibility 100, Best Practices 100 and SEO 90. Scores remain synthetic and may vary; the Markdown summary lists the current metrics and scored findings so a passing floor cannot hide a regression trend.

`npm run verify` is the portable Node/TypeScript/build gate. `npm run verify:full` additionally requires Linux Chrome and runs the browser smoke plus Lighthouse.

## Test design rules

- Assert observable values, state transitions, errors, ordering or exact bytes; do not assert private implementation steps.
- Use byte parity where the serializer is deterministic and structural parity where container metadata is intentionally variable.
- Cover success, boundary and rollback/cancellation paths for stateful work.
- Do not fully extract the 200-file, two-million-row manual fixture in ordinary CI; its automated contract is metadata-only.
- Report browser, screen-reader, native-dialog, external-receiver and real-device evidence separately.
