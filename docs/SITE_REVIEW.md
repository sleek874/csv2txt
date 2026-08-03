# Site-wide implementation review

> **Historical baseline:** this review describes the last settings-driven,
> single-file implementation before the fresh-start "離線資料轉換" work. Keep
> it as verification evidence for reusable conversion, global-style, offline,
> resource-loading, accessibility, and build contracts. It is not the target
> product specification; see [DESIGN.md](DESIGN.md),
> [ARCHITECTURE.md](ARCHITECTURE.md), and [ROADMAP.md](ROADMAP.md).

Review date: 2026-07-30
Scope: application shell, browser workflow, conversion core, settings, styles,
offline/build integration, documentation, and automated tests.

## Global picture

The project is a functional, privacy-first static browser application rather
than a prototype. CSV, XLS, and XLSX inputs converge on one string-row model,
the pure conversion core validates and emits fixed-width Big5 bytes, and the
browser layer owns only file interaction, settings, preview, download, and
offline preparation. Production assets are local and the Content Security
Policy forbids runtime connections.

The current implementation is strongest in deterministic conversion rules,
recoverable settings, static accessibility contracts, and build-time resource
validation. The most important remaining risk is external compatibility: the
consumer's exact Big5 variant and expected Access-produced bytes have not been
confirmed with an approved sanitized source/output pair.

## Efforts completed

### Conversion and data contract

- Implemented strict UTF-8, UTF-16LE/BE, and Big5 decoding with visible
  ambiguity and manual CSV override.
- Implemented positional 15-field conversion, Big5 round-trip validation,
  byte-width padding, CRLF output, and final CRLF.
- Applied source-whitespace handling before empty-row, default, required,
  encoding, and width checks.
- Kept file-level parse/read failures separate from row/field conversion issues.

### Settings and recovery

- Moved persisted settings to the strict version 3 schema.
- Kept per-file CSV encoding outside saved settings.
- Preserved a last-valid settings snapshot while invalid edits remain visible.
- Added explicit settings upload/download and default/recovery actions.

### Browser, accessibility, and offline behavior

- Kept the semantic workflow shell in `index.html` and split field editing,
  settings, results, resources, offline caching, theme, and unload behavior into
  owned modules.
- Retained normal browser refresh behavior with a native leave-page warning only
  while a selected source file is held.
- Added focused live feedback, source-area alerts, keyboard-focusable overflow
  regions, and a no-JavaScript fallback.
- Split base, Excel, and preview-font resource groups and validate them against
  the Vite manifest.

### Recent visual and responsive work

- Centralized light/dark semantic palette, border, radius, shadow, control, and
  responsive-grid primitives.
- Added early saved-theme restoration to reduce first-paint mismatch.
- Reserved stable readiness, filename, metadata, and processing-indicator slots.
- Kept the field editor, issue table, and fixed-width preview scrollable instead
  of compressing their intrinsic horizontal relationships.
- Renamed the source action to `取消選擇` so it does not imply deleting a local
  file.

## Review results by area

| Area | Current state | Evidence and boundaries |
|---|---|---|
| Conversion core | Implemented | Pure modules under `src/core/`; byte output now has direct regression coverage. |
| Settings | Implemented | Strict v3 validation, local autosave, JSON import/export, and last-valid recovery. |
| CSV/Excel input | Implemented | CSV encoding selection is per file; Excel uses the first worksheet and formatted values. |
| Privacy/CSP | Implemented statically | No upload endpoint or runtime asset CDN; build verifier checks the generated policy and resource graph. |
| Offline behavior | Implemented | Base shell, Excel, and font caches are separated; full offline behavior still needs deployed-browser smoke testing. |
| Accessibility | Strong static contract | Semantic shell and ARIA references are build-verified; keyboard and screen-reader journeys still require manual/browser validation. |
| Responsive visual system | Implemented, awaiting browser matrix | Container-driven reflow and bounded scrollers are present; visual regression automation is not yet installed. |
| Documentation | Reconciled | Runtime versions, verification commands, current coverage, and remaining compatibility work are now stated consistently. |
| Automated tests | Improved | Core bytes, encoding, CSV, settings, spreadsheets, whitespace, resource ordering, and static production contracts are covered. |
| Deployment | Hardened | Pages now runs tests before its production build and upload. |

## Points to watch

1. **External byte compatibility remains unproven.** WHATWG Big5/CP950/vendor
   differences, final CRLF, and Access formatting must be confirmed by the
   receiving system with approved sanitized data.
2. **Browser-level coverage is still manual.** The static verifier catches
   structural regressions but cannot prove focus order, dialog behavior, file
   picker flows, screen-reader announcements, or responsive rendering.
3. **The recent CSS uses modern platform features.** `light-dark()`, container
   queries, `inert`, and text clipping need an explicit supported-browser matrix
   and real-device checks.
4. **Large files still run in the main thread.** The 25 MiB limit is enforced,
   but responsiveness has not been benchmarked across representative CSV/XLS/XLSX
   sizes. A worker should be justified by measurements.
5. **Offline correctness must be checked on the deployed origin.** Service
   worker update timing, optional cache reuse, and recovery from interrupted
   downloads are browser/runtime concerns beyond static build assertions.
6. **No project license exists.** Third-party contributions and redistribution
   remain constrained until the owner selects one.

## Test coverage and remaining gaps

Automated coverage now includes:

- encoding BOM detection, ASCII ambiguity, Big5 round trips, and lossy rejection;
- CSV quoting, embedded CRLF, terminal-line handling, and translated parse errors;
- exact left/right Big5 padding, defaults after whitespace handling, blocking
  validation, 208-byte records, and final CRLF;
- settings classification and strict schema rejection;
- XLS/XLSX formatted values, blank cells, formulas, and synthetic fixture parity;
- resource-priority ordering and retry behavior;
- production CSP, offline resource groups, semantic/ARIA invariants, removed
  legacy hooks, and base JavaScript budget.

The next useful automated layer is a small browser suite using only synthetic
fixtures. It should cover settings persistence/recovery, CSV encoding changes,
file deselection, download enablement, theme restoration, keyboard traversal,
and a production service-worker smoke path. Screenshot tests should be limited
to stable light/dark desktop and narrow layouts so they do not become noisy.

## Future plan

### Priority 0 — acceptance evidence

- Obtain owner-approved sanitized CSV and Access-generated TXT output.
- Confirm the consumer's Big5 mapping and CRLF/final-CRLF requirements.
- Run keyboard, screen-reader, reduced-motion, forced-color, light/dark, and
  narrow-layout smoke checks on the production build.

### Priority 1 — browser and performance hardening

- Add focused browser integration tests with synthetic fixtures.
- Benchmark representative CSV/XLS/XLSX files up to the documented limit.
- Move parsing/conversion to a worker only if measurements show disruptive main
  thread blocking.
- Test deployed offline install, optional resource preparation, update, and
  interrupted-cache recovery.

### Priority 2 — release governance

- Define the supported-browser matrix.
- Select and document a project license and contribution policy.
- Require the verified build check on the protected default branch if repository
  policy permits it.
