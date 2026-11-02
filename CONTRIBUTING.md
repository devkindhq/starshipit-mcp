# Contributing to starshipit-mcp

Thanks for your interest in the StarShipIt MCP server.

## Ways to contribute

- Bug reports and feature ideas: open an issue with steps to reproduce.
- Tool output bugs: include the tool name, the arguments and the API response, with all personal and customer data removed.
- Documentation: wording and examples count.

## Development setup

You need Node.js 22 or later and Yarn 1 (`yarn.lock`).

```bash
git clone https://github.com/devkindhq/starshipit-mcp.git
cd starshipit-mcp
yarn install --frozen-lockfile
yarn build
```

To call the live API, put `STARSHIPIT_API_KEY=` and `STARSHIPIT_SUBSCRIPTION_KEY=` with your keys in `.env` (git ignores it), then run `node --env-file=.env dist/index.js`. `yarn dev` runs from source with reload.

## Checks

Run these before you open a pull request. CI runs the same checks on Node.js 22 and 24.

```bash
yarn lint
yarn build
yarn sync-tools                         # writes the tool list into manifest.json
git diff --exit-code -- manifest.json   # must be clean, or commit the change
yarn bundle                             # builds and validates starshipit-mcp.mcpb
```

Run `yarn sync-tools` and commit `manifest.json` after you add, rename or remove a tool.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/). The commit type sets the release:

| Commit type | Release |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `docs:`, `chore:`, `ci:`, `refactor:`, `test:` | none |

## Ground rules

- Keep each pull request to one concern and the smallest change that works.
- Never commit client names, API keys, subscription keys or customer data. Use placeholder names, addresses and order numbers in examples and tests.

## Releases

Each push to `main` runs `.github/workflows/release.yml`:

1. `yarn install --frozen-lockfile` and `yarn build`.
2. semantic-release (`.releaserc.json`) reads the commits since the last tag and picks the next version.
3. It publishes `@devkind/starshipit-mcp` to npm with trusted publishing (OIDC).
4. It writes the version into `server.json`, runs `yarn bundle`, and creates a GitHub release with `starshipit-mcp.mcpb` attached.
5. The workflow publishes `server.json` to the Official MCP Registry. It retries 10 times, 30 seconds apart, because npm can take a minute to serve a new version.

Nothing is committed back to `main`. `package.json` in git keeps its placeholder version.

In the pull request that will release version X.Y.Z, set the `version` in `.claude-plugin/plugin.json` and the `npx` pin in `.mcp.json` to X.Y.Z. semantic-release does not update them, and the plugin directory reads the git copy.

## License

By contributing you agree that your work is released under the ISC License.
