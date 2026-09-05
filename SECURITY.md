# Security policy

## Supported versions

Security fixes are available for the latest published version only.
Older versions no longer receive security updates.

## Your data stays local

API Designer processes contracts on your machine. It makes no network requests
and uses no telemetry or analytics.

- Edits are applied to the open contract. You can save through VS Code; starting
  a Markdown export or a schema conversion also saves pending changes.
- Designer layout metadata can be stored in the contract under `x-api-designer`
  and is visible in the diff.
- Creating a contract or saving generated schemas and Markdown exports writes
  additional files to the location you choose or confirm.

The extension exposes no user settings and does not store data in VS Code's
global or workspace state. Its webview blocks remote resources and connections;
scripts and styles are included locally.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** option on GitHub.
Please keep security details out of public issues.

If private reporting is unavailable, open an issue with a general description
of the problem and ask how to share the details privately. Do not include
exploit steps or sensitive data in that issue.

## Share a safe example

For bug and security reports:

- Use a small, made-up contract that reproduces the problem, rather than a real contract.
- Remove credentials, internal hostnames, production values and identifying names.
  Check examples, defaults and server URLs too.
- Remove sensitive details from screenshots.
- Include the extension version, contract format, steps to reproduce and expected result.
