# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest stable ([v3.0.0](https://github.com/aquantumofdonuts/mixarr/releases/tag/v3.0.0)) | :white_check_mark: |
| < Latest | :x:               |

See the [upgrade guide](README.md#upgrading) before moving from v2 to v3. Keep your session secret and persistent data; v3.0.0 includes breaking changes for custom API clients.

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them through one of these channels:

1. **GitHub Security Advisories** (preferred): Navigate to the [Security tab](https://github.com/aquantumofdonuts/mixarr/security/advisories) of this repository and click "Report a vulnerability"
2. **Email**: Send details to the maintainers listed in the repository

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation | Within 30 days for critical/high severity |

### What to Expect

- You'll receive an acknowledgment within 48 hours
- We'll work with you to understand and validate the issue
- We'll keep you informed of our progress
- We'll credit you in the fix (unless you prefer anonymity)

## Scope

The following are in scope:
- The Mixarr application code (API and web frontend)
- Authentication and authorization mechanisms
- Data handling and storage
- Docker container configurations
- Third-party integration security

The following are out of scope:
- Vulnerabilities in upstream dependencies (report these to the dependency maintainer)
- Social engineering attacks
- Denial of service attacks that require excessive resources
- Issues in third-party services that Mixarr integrates with (Lidarr, Spotify, etc.)

## Security Best Practices for Deployers

- Always set a strong `SESSION_SECRET` environment variable
- Use HTTPS in production (the default Caddy configuration handles this)
- Change default database passwords before deploying
- Keep your Mixarr installation updated to the latest version
- Do not expose the API port (3005) directly — use the reverse proxy
