# Security

## Supported Versions

Security updates target the current `main` branch until tagged releases exist.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability that could expose task data, local files, credentials, or deployment details.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, contact the maintainer through the GitHub profile and share only the minimum detail needed to arrange a private report.

Include:

- Affected version or commit
- Steps to reproduce
- Expected and observed behavior
- Any logs with secrets and personal data removed

## Security Model

Doit has no built-in authentication. Treat it as a local single-user service and place authentication, TLS, and network access controls in front of it before remote use.
