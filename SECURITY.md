# Security Policy

## Supported versions

The project is currently in design and has no production release. Security
updates will target the latest code on the default branch.

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
