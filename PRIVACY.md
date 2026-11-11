# Privacy policy: StarShipIt MCP server

Effective date: 11 November 2026

This policy covers the StarShipIt MCP server (`@devkind/starshipit-mcp`) and its Claude plugin, published by Devkind. The server runs where you start it, by default on your own machine. Devkind does not run a hosted copy and does not receive any of your data.

## What the server handles

- **Your StarShipIt API key and subscription key**, which you enter when you set up the server or install the plugin.
- **Tool arguments and results**, such as order details, customer names, delivery addresses, tracking numbers, and the label, packing slip and manifest links or files that StarShipIt returns.

## Where the data goes

- The server sends each request only to the StarShipIt API at `https://api.starshipit.com/api`. Each request carries your two keys and the tool arguments.
- Tool results return to your MCP client, such as Claude. The client handles them under its own privacy terms. The server does not open the label or document links that StarShipIt returns.
- On install, `npx` downloads the server package from the npm registry.

## How the data is used

The server uses this data only to make the request you ask for. Devkind does not receive, use or sell it.

## What is stored

- The server stores no data and writes no files. It keeps nothing after a request completes.
- The server sends no telemetry or analytics to Devkind or anyone else. It writes error messages to stderr on your machine only.
- When you install the plugin in Claude Code, Claude Code keeps your keys in your system's secure credential store.

## Third parties

StarShipIt processes the data you send to its API under its own policy: [starshipit.com/privacy-policy](https://starshipit.com/privacy-policy).

## Children

The server is a business shipping tool. It is not intended for people under 18.

## Changes and contact

Devkind updates this file when the server's data handling changes. The repository history records each change. Send questions to hello@devkind.com.au.
