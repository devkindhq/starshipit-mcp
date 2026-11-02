# Security Policy

## Supported versions

Only the latest release of `@devkind/starshipit-mcp` on npm gets security fixes.

## Reporting a vulnerability

Email security@devkind.com.au. Include the affected version, the steps to reproduce and the impact.

Do not open a public issue for a suspected vulnerability. We aim to reply within 5 business days.

## Scope notes

- The server sends your StarShipIt keys only to `https://api.starshipit.com/api`.
- HTTP mode has no authentication. It listens on `127.0.0.1` by default and rejects foreign `Host` headers. If you bind it to another address, put an authenticating proxy in front of it.
- If you think a StarShipIt key leaked, rotate it in StarShipIt under **Settings > API**.
