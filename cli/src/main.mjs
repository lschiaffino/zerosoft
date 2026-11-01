// Comandos de la CLI. Códigos de salida: 0 bien, 1 falló, 2 uso, 3 sesión, 4 sin permiso o no existe, 5 rate limit.
import fs from 'node:fs';
import path from 'node:path';
import { aliasCandidates, flagValue, parseArgs } from './args.mjs';
import { baseUrlFrom, exitCodeForStatus, McpClient } from './client.mjs';
import { deleteCredentials, loadCredentials, saveCredentials } from './credentials.mjs';
import { browserLogin, CliError, deviceLogin, revoke } from './oauth.mjs';
import { human, printJson, table, wantsJson } from './output.mjs';

const VERSION = '0.1.0';

const HELP = {
  main: `zerosoft: everything you can do in the 24 apps, as you, from a terminal or a script.

Usage
  zerosoft <command> [options]
  zerosoft <app> <resource> <verb> [id] [--field value]

Session
  login            Sign in through the browser (--device without one, --read-only)
  logout           Disconnect this device
  whoami           Who you are, the workspace and what this device may do
  workspaces       Your workspaces
  switch <teamId>  Move this device to another workspace ("own" is yours)

Discover and run
  apps             Apps you can use, with their operations
  ops search <t>   Find an operation by words
  ops show <id>    The exact input of an operation
  call <op>        Run an operation (--json '{"path":{},"query":{},"body":{}}')

Shortcuts
  zerosoft crm contacts list --limit 5
  zerosoft crm contacts create --name "Ana"
  zerosoft track issues create --projectId p1 --title "Fix it"
  zerosoft crm deals get <id>

Setup
  setup claude     Print the command that connects Claude Code

Options
  --json           Output JSON (the default when piped)
  --server <url>   Server (default https://zerosoft.ai, or ZEROSOFT_URL)
  --help           Help for any command
  --version        CLI version

Environment
  ZEROSOFT_API_KEY  Use an API key instead of signing in (for CI)

Exit codes: 0 ok, 1 failed, 2 usage, 3 signed out, 4 no permission or not found, 5 rate limited.`,
  login: `zerosoft login [--device] [--read-only] [--no-open] [--server <url>]

Signs in through your browser and stores the token in the OS keychain, or in a
0600 file if there is none.

  --device      No browser on this machine: shows a code to approve elsewhere
  --read-only   Ask only for read access
  --no-open     Print the sign-in URL without opening a browser`,
  logout: `zerosoft logout [--server <url>]\n\nDisconnects this device on the server and deletes the local token.`,
  whoami: `zerosoft whoami [--json]\n\nThe signed-in person, the workspace, the role and the apps.`,
  workspaces: `zerosoft workspaces [--json]\n\nThe workspaces you belong to.`,
  switch: `zerosoft switch <teamId|own>\n\nMoves this device to another workspace. Your browser stays where it is.`,
  apps: `zerosoft apps [--json]\n\nThe apps you can use in this workspace, with how many operations each has.`,
  ops: `zerosoft ops search <text> [--app <app>] [--access read|write|destructive] [--limit <n>] [--offset <n>]
zerosoft ops show <operation>

Finds operations and shows their exact input.`,
  call: `zerosoft call <operation> [--json '{...}' | --input file.json] [--confirm] [--offset <n>] [--limit-page <n>] [--field value]

Runs one operation. The input has the shape { path, query, body }, as "ops show"
prints it. Any other --field goes to the path, query or body by its name.
Destructive operations need --confirm.

  --json '{...}'        The input as JSON (--json alone asks for JSON output)
  --input file.json     The input from a file, or - for stdin
  --offset, --limit-page  Continue a long result, from page.nextOffset
  --file field=path     Attach a file to a multipart operation (repeatable)`,
  setup: `zerosoft setup claude [--server <url>]\n\nPrints the commands that connect Claude Code and claude.ai to this server.`,
};

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function emit(flags, value, render) {
  if (wantsJson(flags)) printJson(value);
  else process.stdout.write(`${render ? render(value) : human(value)}\n`);
}

async function cmdLogin(flags, baseUrl) {
  const scope = flags['read-only'] ? 'read' : 'read write';
  const headless = flags.device || (!flags['no-open'] && (process.env.SSH_TTY || (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)));
  const creds = headless
    ? await deviceLogin({ baseUrl, scope, log })
    : await browserLogin({ baseUrl, scope, log, open: !flags['no-open'] });
  const where = saveCredentials(baseUrl, creds);
  const client = new McpClient(baseUrl);
  const { result } = await client.tool('whoami');
  log(`Signed in as ${result.person.email} in ${result.workspace.name || 'your workspace'}${creds.scope === 'read' ? ' (read only)' : ''}.`);
  log(where === 'keychain' ? 'The token is in the OS keychain.' : `The token is in ${where} (only you can read it).`);
  if (wantsJson(flags)) printJson({ ok: true, email: result.person.email, scope: creds.scope, stored: where === 'keychain' ? 'keychain' : 'file' });
}

async function cmdLogout(flags, baseUrl) {
  const creds = loadCredentials(baseUrl);
  if (creds) await revoke(creds);
  deleteCredentials(baseUrl);
  if (wantsJson(flags)) printJson({ ok: true });
  else log('Signed out.');
}

async function cmdSetup(positional, flags, baseUrl) {
  if (positional[0] && positional[0] !== 'claude') throw new CliError('Usage: zerosoft setup claude', 2);
  const command = `claude mcp add --transport http zerosoft ${baseUrl}/api/mcp`;
  if (wantsJson(flags)) return printJson({ claudeCode: command, connectorUrl: `${baseUrl}/api/mcp` });
  process.stdout.write(`Claude Code:\n  ${command}\n  Then run /mcp inside Claude Code and sign in.\n\nclaude.ai:\n  Settings, Connectors, Add custom connector, and paste ${baseUrl}/api/mcp\n`);
}

async function readInput(flags) {
  let input = {};
  const inline = flags['json-input'] ?? (typeof flags.json === 'string' ? flags.json : undefined);
  if (inline !== undefined) {
    try {
      input = JSON.parse(inline);
    } catch {
      throw new CliError('The JSON input does not parse.', 2);
    }
  } else if (typeof flags.input === 'string') {
    try {
      input = JSON.parse(flags.input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(flags.input, 'utf8'));
    } catch (e) {
      throw new CliError(`Could not read the input: ${e.message}`, 2);
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CliError('The input must be a JSON object.', 2);
  return input;
}

const RESERVED_FLAGS = new Set(['json', 'json-input', 'input', 'confirm', 'offset', 'limit-page', 'help', 'server', 'file']);

function filesFrom(flags) {
  const raw = flags.file === undefined ? [] : Array.isArray(flags.file) ? flags.file : [flags.file];
  return raw.map((spec) => {
    const at = String(spec).indexOf('=');
    const field = at > 0 ? String(spec).slice(0, at) : 'file';
    const p = at > 0 ? String(spec).slice(at + 1) : String(spec);
    try {
      return { field, filename: path.basename(p), base64: fs.readFileSync(p).toString('base64') };
    } catch (e) {
      throw new CliError(`Could not read ${p}: ${e.message}`, 2);
    }
  });
}

async function runOperation(client, operation, args, flags) {
  const files = filesFrom(flags);
  const { result } = await client.tool('invoke_operation', {
    operation,
    args: { ...args, ...(files.length ? { files } : {}) },
    raw: true,
    ...(flags.confirm ? { confirm: true } : {}),
    ...(flags.offset !== undefined ? { offset: Number(flags.offset) } : {}),
    ...(flags['limit-page'] !== undefined ? { limit: Number(flags['limit-page']) } : {}),
  });
  if (wantsJson(flags)) printJson(result);
  else {
    process.stdout.write(`${human(result.data)}\n`);
    if (result.message) log(result.message);
    if (result.page?.nextOffset != null) log(`More results: --offset ${result.page.nextOffset}`);
  }
  if (!result.ok) process.exitCode = exitCodeForStatus(result.status);
}

function flagsToArgs(flags) {
  const args = {};
  for (const [k, v] of Object.entries(flags)) if (!RESERVED_FLAGS.has(k)) args[k] = flagValue(v);
  return args;
}

async function cmdCall(positional, flags, client) {
  const operation = positional[0];
  if (!operation) throw new CliError('Usage: zerosoft call <operation> [--json-input ...]', 2);
  await runOperation(client, operation, { ...(await readInput(flags)), ...flagsToArgs(flags) }, flags);
}

async function cmdOps(positional, flags, client) {
  const sub = positional[0];
  if (sub === 'search') {
    const query = positional.slice(1).join(' ');
    const { result } = await client.tool('search_operations', {
      query,
      ...(flags.app ? { app: flags.app } : {}),
      ...(flags.access ? { access: flags.access } : {}),
      ...(flags.limit ? { limit: Number(flags.limit) } : {}),
      ...(flags.offset ? { offset: Number(flags.offset) } : {}),
    });
    return emit(flags, result, (r) => `${table(r.operations, ['id', 'access', 'method', 'path'])}\n\n${r.total} found`);
  }
  if (sub === 'show') {
    if (!positional[1]) throw new CliError('Usage: zerosoft ops show <operation>', 2);
    const { result } = await client.tool('get_operation_schema', { operation: positional[1] });
    return emit(flags, result, (r) => [`${r.id}  (${r.access})`, `${r.method} ${r.path}`, r.doc ? `\n${r.doc}` : '', `\nSchema: ${r.schema}`, JSON.stringify(r.inputSchema, null, 2)].join('\n'));
  }
  throw new CliError(HELP.ops, 2);
}

/** `zerosoft crm contacts list ...`: busca el id más largo que exista; lo que sobra son parámetros de path. */
async function cmdAlias(positional, flags, client) {
  let found = null;
  for (const candidate of aliasCandidates(positional)) {
    try {
      const { result } = await client.tool('get_operation_schema', { operation: candidate.id });
      found = { schema: result, rest: candidate.rest };
      break;
    } catch (e) {
      if (e.code !== 'not_found') throw e;
    }
  }
  if (!found) {
    const { result } = await client.tool('search_operations', { query: positional.join(' '), limit: 5 });
    const hint = result.operations.length ? `\nDid you mean:\n${result.operations.map((o) => `  ${o.id}`).join('\n')}` : '';
    if (flags.help) {
      const { result: all } = await client.tool('search_operations', { query: positional.join(' '), limit: 50 });
      process.stdout.write(`${table(all.operations, ['id', 'access', 'method', 'path'])}\n\n${all.total} operations. See one with: zerosoft ops show <id>\n`);
      return;
    }
    throw new CliError(`Unknown command or operation: ${positional.join(' ')}.${hint}\nSee zerosoft --help.`, 2);
  }
  const { schema, rest } = found;
  if (flags.help) {
    process.stdout.write(`${schema.id}  (${schema.access})\n${schema.method} ${schema.path}\n${schema.doc ? `\n${schema.doc}\n` : ''}\n${JSON.stringify(schema.inputSchema, null, 2)}\n`);
    return;
  }
  const params = Object.keys(schema.inputSchema?.properties?.path?.properties ?? {});
  if (rest.length > params.length) throw new CliError(`Too many arguments for ${schema.id}: ${rest.join(' ')}`, 2);
  const pathArgs = {};
  rest.forEach((v, i) => {
    pathArgs[params[i]] = v;
  });
  const args = { ...(await readInput(flags)), ...flagsToArgs(flags), ...(rest.length ? { path: pathArgs } : {}) };
  await runOperation(client, schema.id, args, flags);
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const command = positional[0];
  const rest = positional.slice(1);
  if (!command) {
    process.stdout.write(`${HELP.main}\n`);
    if (!flags.help) process.exitCode = 2;
    return;
  }
  if (flags.help && HELP[command]) {
    process.stdout.write(`${HELP[command]}\n`);
    return;
  }
  if (command === 'help') {
    process.stdout.write(`${HELP[rest[0]] ?? HELP.main}\n`);
    return;
  }
  const baseUrl = baseUrlFrom(typeof flags.server === 'string' ? flags.server : undefined);
  const client = new McpClient(baseUrl);
  switch (command) {
    case 'login':
      return cmdLogin(flags, baseUrl);
    case 'logout':
      return cmdLogout(flags, baseUrl);
    case 'setup':
      return cmdSetup(rest, flags, baseUrl);
    case 'whoami': {
      const { result } = await client.tool('whoami');
      return emit(flags, result, (r) =>
        [
          `Person     ${r.person.email}`,
          `Workspace  ${r.workspace.name || 'Your workspace'}`,
          `Role       ${r.role}`,
          `Apps       ${r.apps === '*' ? 'all' : r.apps.join(', ')}`,
          `Access     ${r.connection.canWrite ? 'read and write' : 'read only'} (${r.connection.client})`,
        ].join('\n'),
      );
    }
    case 'workspaces': {
      const { result } = await client.tool('list_workspaces');
      return emit(flags, result, (r) => table(r.workspaces.map((w) => ({ ...w, current: w.teamId === r.current ? '*' : '' })), ['current', 'teamId', 'name', 'role', 'mode']));
    }
    case 'switch': {
      if (!rest[0]) throw new CliError('Usage: zerosoft switch <teamId|own>', 2);
      const { result } = await client.tool('switch_workspace', { teamId: rest[0] === 'own' ? null : rest[0] });
      return emit(flags, result, () => 'Done.');
    }
    case 'apps': {
      const { result } = await client.tool('list_apps');
      return emit(flags, result, (r) => table(r.apps, ['app', 'name', 'operations', 'read', 'write', 'destructive']));
    }
    case 'ops':
      return cmdOps(rest, flags, client);
    case 'call':
      return cmdCall(rest, flags, client);
    default:
      return cmdAlias(positional, flags, client);
  }
}
