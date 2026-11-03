# Security Policy

## Supported versions

The latest release of `@devkind/starshipit-mcp` on npm and the tip of `main` are supported.

## Reporting a vulnerability

Email the maintainers via the Devkind GitHub organisation
(open a private security advisory on the repo if enabled, or contact an admin).

Please do not open public issues for suspected vulnerabilities. We aim to
respond within 5 business days.

## Scope notes

This project calls the StarShipIt API with your API key and subscription key.
Tools can create, edit and delete live StarShipIt data and print labels.
Report vulnerabilities in the StarShipIt API itself to StarShipIt.

## Hardening already in place

- The keys go only to `https://api.starshipit.com/api`.
- HTTP mode (`TRANSPORT=http`) has no authentication. It listens on `127.0.0.1`
  by default and rejects foreign `Host` headers. If you bind it to another
  address, put an authenticating proxy in front of it.
- The Claude Code plugin stores both keys as `sensitive` user settings.
