# Security Policy

## Supported versions

The project is currently in design and has no production release. Security
updates will target the latest code on the default branch.

## Browser embedding

The application refuses to initialize when embedded in an iframe and offers a
direct-open link instead. This is a runtime clickjacking mitigation for GitHub
Pages, which does not provide repository-controlled HTTP response headers. It is
not a substitute for a header-delivered `Content-Security-Policy: frame-ancestors
'none'` policy if the application moves to a host that supports custom headers.

## Development and build environment

- Use the Node.js 24 LTS patch pinned in `.nvmrc`; the package engine constraints
  reject older Node 24 releases and other major versions.
- CI and GitHub Pages disable automatic package-manager caching and install the
  lockfile with dependency lifecycle scripts disabled.
- GitHub Actions are pinned to immutable full-length commit SHAs.
- Dependabot checks npm packages and GitHub Actions weekly.
- High-severity dependency audit findings block CI and deployment.
- Vite permits inline styles only in the local development server for CSS hot
  reload; production keeps the stricter external-style policy.
- Review dependency changes before using `npm install`; normal clean installs use
  `npm ci --ignore-scripts`.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities, exposed sensitive data, or test
fixtures derived from production data.

Use GitHub's private vulnerability reporting feature for this repository. If it
is not enabled, contact the repository owner privately and ask for a secure
reporting channel. Do not include real CSV contents in the initial message.

Please include:

- A concise description and impact
- Reproduction steps using synthetic data
- Affected browser and version
- Whether any data left the browser
- Suggested remediation, if known

## Data handling promise

The intended application performs conversion entirely in the browser. Any
unexpected network transfer of source data, output data, previews, validation
values, or filenames is considered a security defect.
