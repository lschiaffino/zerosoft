# zerosoft CLI

Everything you can do in the 24 zerosoft apps, as you, from a terminal or a script. It talks only to the MCP endpoint (`/api/mcp`), the same one Claude uses. No dependencies; Node 18.17 or newer.

## Run it from the repo

```sh
node cli/bin/zerosoft.mjs --help
# or put `zerosoft` on your PATH:
cd cli && npm link
```

`npm link` only touches this folder and your global bin. The root install does not depend on it.

## Use

```sh
zerosoft login                       # browser, loopback redirect
zerosoft login --device              # no browser here: approve a code elsewhere
zerosoft login --read-only
zerosoft whoami
zerosoft apps
zerosoft ops search "deal move"
zerosoft ops show crm.deals.update
zerosoft crm contacts list
zerosoft crm contacts create --name "Ana"
zerosoft crm deals get <id>
zerosoft track issues create --projectId <id> --title "Fix it"
zerosoft call crm.deals.update --json '{"path":{"id":"d1"},"body":{"priority":"high"}}'
zerosoft call crm.deals.delete --json '{"path":{"id":"d1"}}' --confirm
zerosoft setup claude                # prints the Claude Code command
zerosoft logout
```

`zerosoft <app> <resource> <verb>` joins the words into an operation id, tries the longest match, and treats what is left as path parameters. `--field value` goes to the path, query or body by name. Use `--limit-page` and `--offset` for the MCP pagination of a long result; `--limit` goes to the operation.

Output is JSON when piped or with `--json`, and a table on a terminal.

| Exit code | Meaning |
| --- | --- |
| 0 | OK |
| 1 | The operation or the network failed |
| 2 | Usage, invalid input, or a missing `--confirm` |
| 3 | Not signed in, or the session ended |
| 4 | No permission, or not found |
| 5 | Rate limited |

| Variable | Use |
| --- | --- |
| `ZEROSOFT_URL` | Server (default `https://zerosoft.ai`). Must be https, or http on localhost |
| `ZEROSOFT_API_KEY` | Use an API key instead of signing in, for CI |
| `ZEROSOFT_CONFIG_DIR` | Where non-keychain files go (default `~/.config/zerosoft`) |
| `ZEROSOFT_NO_KEYCHAIN=1` | Always use the 0600 file |

Tokens go to the macOS Keychain or to libsecret (`secret-tool`) on Linux, and otherwise to a 0600 file. On Windows it is the file, for now.

## What publishing requires (not done)

The package is `"private": true` on purpose. To publish it:

1. Decide the npm name. `zerosoft` may need to be checked for availability, or use a scope such as `@zerosoft/cli` (then keep `bin.zerosoft`).
2. Remove `"private": true` from `cli/package.json` and pick the version.
3. Check the license field against the repo's license.
4. `cd cli && npm publish --access public`, from an npm account with 2FA, ideally from CI with provenance.
5. Update the "not on npm yet" text in `content/mcp-docs.ts` (three languages) and `lib/mcp` docs.
