# Security Policy

## Supported Versions

Security fixes are applied to the latest release on the default branch.

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

If you discover a security issue, please report it privately and do not open a public issue.

- Preferred: Direct message `deivid11` on Discord
- Email: `security@tidecommander.dev`
- Include:
  - A clear description of the issue
  - Reproduction steps or proof of concept
  - Impact assessment (what an attacker can do)
  - Affected version/commit and environment details
  - Any suggested remediation, if available

## Disclosure Process

When we receive a report, we aim to:

1. Acknowledge receipt within 72 hours
2. Triage and validate the report
3. Provide status updates during investigation
4. Ship a fix and publish a coordinated disclosure note

## Scope Notes

This project can run local automation and shell commands through agent runtimes.

- Treat Tide Commander as a high-trust local tool
- Review agent permissions before running untrusted prompts
- Do not store plain secrets in repository files
- Use the built-in secrets system for credential injection

## Safe Usage Recommendations

- Run with least privilege possible on your machine
- Restrict exposed ports when deploying beyond localhost
- Keep dependencies and runtimes updated
- Avoid sharing session logs that may include sensitive content
