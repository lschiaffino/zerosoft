import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeUser } from './helpers';

/**
 * El hook y el instalador de verdad (sh + perl + curl) contra las rutas de la app servidas en un puerto local, con
 * un HOME de prueba: nada toca el ~/.claude de quien corre los tests.
 */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  requireUser: async () => session.user,
  isWorkspaceAdmin: () => true,
  realUserId: (u: { id: string }) => u.id,
}));

const ingestRoute = await import('@/app/api/fleet/ingest/route');
const hookRoute = await import('@/app/api/fleet/hook/route');
const installRoute = await import('@/app/api/fleet/install/route');
const tokensRoute = await import('@/app/api/fleet/tokens/route');
const messagesRoute = await import('@/lib/routes/fleet/sessions/[id]/messages/route');

const hasTools = ['sh', 'perl', 'curl'].every((bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0);
const received: unknown[] = [];
let server: Server;
let base = '';

beforeAll(async () => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = `http://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, { method: req.method, headers, body: req.method === 'GET' ? undefined : body });
    let out: Response;
    if (req.url === '/api/fleet/ingest') {
      received.push(JSON.parse(body || 'null'));
      out = await ingestRoute.POST(request as never);
    } else if (req.url === '/api/fleet/hook') out = await hookRoute.GET();
    else if (req.url === '/api/fleet/install') out = await installRoute.GET(request as never);
    else out = new Response('not found', { status: 404 });
    res.writeHead(out.status, Object.fromEntries(out.headers.entries()));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((r) => server.close(r));
});

/** Async: el servidor de las rutas corre en este mismo proceso y un exec sincrónico lo trabaría. */
function sh(script: string, env: Record<string, string>, input = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-c', script], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 30_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
    child.stdin?.end(input);
  });
}

describe.skipIf(!hasTools)('Fleet: instalador y hook (sh + perl + curl)', () => {
  it('instala sin tocar los hooks de Orca, entrega una respuesta en el Stop y se desinstala', { timeout: 90_000 }, async () => {
    const u = await makeUser('fleet-hook');
    session.user = { id: u.id, email: u.email, name: 'x', role: 'owner', actingUser: null, team: null, apps: '*' };
    const created = (await (await tokensRoute.POST(new Request(`${base}/api/fleet/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"label":"test"}' }) as never)).json()) as { token: string };

    const home = mkdtempSync(join(tmpdir(), 'fleet-home-'));
    const claude = join(home, '.claude');
    mkdirSync(claude);
    const orcaHook = { type: 'command', command: 'sh "$HOME/.orca/agent-hooks/claude-hook.sh"' };
    writeFileSync(join(claude, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [orcaHook] }], PreToolUse: [{ matcher: 'Bash', hooks: [orcaHook] }] } }, null, 2));
    const env = { HOME: home, CLAUDE_CONFIG_DIR: claude };

    const installer = await (await fetch(`${base}/api/fleet/install`)).text();
    writeFileSync(join(home, 'install.sh'), installer);
    await sh(`sh "$HOME/install.sh" ${created.token}`, env);
    // Dos veces: no duplica.
    await sh(`sh "$HOME/install.sh" ${created.token}`, env);

    const settings = JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')) as { model: string; hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number }> }>> };
    expect(settings.model).toBe('opus');
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('.orca');
    expect(settings.hooks.Stop.flatMap((g) => g.hooks).map((h) => h.command)).toEqual([orcaHook.command, `sh '${home}/.zerosoft/fleet-hook.sh'`]);
    for (const ev of ['SessionStart', 'UserPromptSubmit', 'Notification', 'SubagentStop', 'StopFailure', 'SessionEnd']) {
      expect(settings.hooks[ev].flatMap((g) => g.hooks).filter((h) => h.command.includes('fleet-hook.sh'))).toHaveLength(1);
    }
    expect(existsSync(join(claude, 'settings.json.zerosoft-backup'))).toBe(true);
    // El token queda en un archivo que solo lee la persona, y nunca en settings.json.
    expect(statSync(join(home, '.zerosoft', 'fleet.curlrc')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(claude, 'settings.json'), 'utf8')).not.toContain(created.token);

    const hook = `sh "$HOME/.zerosoft/fleet-hook.sh"`;
    const cwd = join(home, 'projects', 'web');
    mkdirSync(cwd, { recursive: true });
    const prompt = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'hook-1', cwd, transcript_path: `${home}/.claude/projects/x.jsonl`, prompt: 'Fix it, token ghp_abcdefghijklmnopqrstuvwxyz012345' });
    expect(JSON.parse(await sh(hook, { ...env, ORCA_PANE_KEY: 'pane-9', ORCA_WORKTREE_ID: 'wt-1' }, prompt))).toEqual({});
    const sent = received.at(-1) as Record<string, unknown>;
    // Solo lo de la lista: nada de rutas, transcript ni el secreto.
    expect(Object.keys(sent).sort()).toEqual(['branch', 'detail', 'event', 'orca_pane', 'orca_tab', 'orca_worktree', 'project', 'session', 'stop_hook_active', 'text']);
    expect(sent).toMatchObject({ event: 'UserPromptSubmit', session: 'hook-1', project: 'web', orca_pane: 'pane-9', orca_worktree: 'wt-1' });
    expect(JSON.stringify(sent)).not.toContain(home);
    expect(sent.text).toBe('Fix it, token [redacted]');

    // Una respuesta en cola sale en el próximo Stop como {"decision":"block"}.
    const row = (await import('@/lib/db')).getDb();
    const s = (await row.prepare('SELECT id FROM fleet_sessions WHERE workspace_id = ? AND session_key = ?').get(u.id, 'hook-1')) as { id: string };
    await messagesRoute.POST(new Request(`${base}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Run the tests before you stop' }) }) as never, { params: Promise.resolve({ id: s.id }) });
    const stop = JSON.stringify({ hook_event_name: 'Stop', session_id: 'hook-1', cwd, stop_hook_active: false, last_assistant_message: 'Fixed.' });
    expect(JSON.parse(await sh(hook, env, stop))).toEqual({ decision: 'block', reason: 'Run the tests before you stop' });
    expect(JSON.parse(await sh(hook, env, stop))).toEqual({});

    // Eventos que no son del hook y zerosoft caído: {} sin trabar al agente.
    expect(JSON.parse(await sh(hook, env, JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'hook-1' })))).toEqual({});
    writeFileSync(join(home, '.zerosoft', 'fleet.env'), 'ZEROSOFT_FLEET_URL=http://127.0.0.1:9\nZEROSOFT_FLEET_WAIT=0\n');
    expect(JSON.parse(await sh(hook, env, stop))).toEqual({});

    await sh(`sh "$HOME/install.sh" --uninstall`, env);
    const after = JSON.parse(readFileSync(join(claude, 'settings.json'), 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(after.hooks.Stop.flatMap((g) => g.hooks).map((h) => h.command)).toEqual([orcaHook.command]);
    expect(after.hooks.SessionStart).toBeUndefined();
    expect(existsSync(join(home, '.zerosoft', 'fleet.curlrc'))).toBe(false);
  });
});
