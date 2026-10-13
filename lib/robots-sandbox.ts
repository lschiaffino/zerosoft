/**
 * Robots — backend Vercel Sandbox. Server-only.
 *
 * Cada corrida crea una microVM efímera (persistent: false) desde un snapshot
 * con playwright-core + Chromium ya instalados, sube el script del runner y
 * el job, lo ejecuta con un timeout duro, lee result.json y la detiene.
 *
 * Snapshot: ROBOTS_SANDBOX_SNAPSHOT_ID si está; si no, el último guardado en
 * la tabla robot_runtime; si no hay (o venció), se arma uno en el momento
 * (instala dependencias del sistema + Chromium, ~1-2 min) y se guarda sin
 * vencimiento. `scripts/robots-sandbox-snapshot.ts` lo prepara por adelantado.
 *
 * Red: la VM puede salir a internet pero no a rangos privados (subnets.deny);
 * además el arnés bloquea en el navegador cada host que resuelva a una IP
 * privada, igual que safeFetch.
 */
import { getDb } from './db';
import { isPrivateAddress, robotHarness, robotInterpreter } from './robots-interpreter';
import { failed, harnessJob, type RobotJob, type RobotRunnerResult } from './robots-runner';

const PLAYWRIGHT_VERSION = '1.64.0';
const ROOT = '/vercel/sandbox/robot';
const BROWSERS = '/vercel/sandbox/ms-playwright';
const IMAGE = 'vercel/sandbox/node:24';
const SNAPSHOT_KEY = `sandbox_snapshot:${PLAYWRIGHT_VERSION}`;

const PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '0.0.0.0/8',
  '224.0.0.0/3',
  'fc00::/7',
  'fe80::/10',
  '::1/128',
];

type SandboxModule = typeof import('@vercel/sandbox');
type SandboxInstance = Awaited<ReturnType<SandboxModule['Sandbox']['create']>>;

/** Script que corre dentro de la VM: arnés + intérprete serializados. */
export function buildRunnerScript(): string {
  // __name: helper que esbuild (tsx/vitest) agrega a funciones con nombre;
  // con SWC (next build) no aparece, pero el shim no molesta.
  return `'use strict';
const __name = (fn) => fn;
const fs = require('fs');
const dns = require('dns').promises;
const { chromium } = require('playwright-core');
const isPrivateAddress = ${isPrivateAddress.toString()};
const robotInterpreter = ${robotInterpreter.toString()};
const robotHarness = ${robotHarness.toString()};
async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'invalid_url'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid_url';
  const host = u.hostname.replace(/^\\[|\\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return 'private_host';
  let addrs;
  if (/^[0-9.]+$/.test(host) || host.includes(':')) addrs = [host];
  else {
    try { addrs = (await dns.lookup(host, { all: true })).map((a) => a.address); } catch { return 'unresolvable_host'; }
  }
  if (!addrs.length) return 'unresolvable_host';
  if (addrs.some((a) => isPrivateAddress(a))) return 'private_host';
  return null;
}
(async () => {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  job.deadline = Date.now() + job.timeoutMs;
  const result = await robotHarness(chromium, job, robotInterpreter, checkUrl);
  fs.writeFileSync(process.argv[3], JSON.stringify(result));
})().catch((e) => {
  fs.writeFileSync(process.argv[3], JSON.stringify({ status: 'failed', error: 'runner_crash: ' + String((e && e.message) || e).slice(0, 200), vars: {}, logs: [], screenshots: [], pages: 0 }));
});
`;
}

async function loadSdk(): Promise<SandboxModule> {
  return import('@vercel/sandbox');
}

/** Credenciales explícitas fuera de Vercel (en Vercel el SDK usa OIDC solo). */
function credentials(): Record<string, string> {
  if (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === '1') return {};
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

async function getStoredSnapshot(): Promise<string | null> {
  if (process.env.ROBOTS_SANDBOX_SNAPSHOT_ID) return process.env.ROBOTS_SANDBOX_SNAPSHOT_ID;
  const row = (await getDb().prepare('SELECT value FROM robot_runtime WHERE key = ?').get(SNAPSHOT_KEY)) as
    | { value: string }
    | undefined;
  return row?.value || null;
}

async function storeSnapshot(id: string | null): Promise<void> {
  if (!id) {
    await getDb().prepare('DELETE FROM robot_runtime WHERE key = ?').run(SNAPSHOT_KEY);
    return;
  }
  await getDb()
    .prepare(
      `INSERT INTO robot_runtime (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(SNAPSHOT_KEY, id, new Date().toISOString());
}

async function check(sbx: SandboxInstance, cmd: string, args: string[], opts: { sudo?: boolean; env?: Record<string, string> } = {}) {
  const r = await sbx.runCommand({ cmd, args, sudo: opts.sudo, env: opts.env, cwd: ROOT });
  if (r.exitCode !== 0) {
    const err = (await r.stderr().catch(() => '')).slice(-500);
    throw new Error(`setup failed (${cmd} ${args.join(' ')}): ${err}`);
  }
}

/**
 * Arma el snapshot base: playwright-core + Chromium headless + librerías del
 * sistema. Devuelve el id (sin vencimiento).
 */
export async function createRobotsSnapshot(): Promise<string> {
  const { Sandbox } = await loadSdk();
  const sbx = await Sandbox.create({
    ...credentials(),
    image: IMAGE,
    resources: { vcpus: 2 },
    timeout: 10 * 60_000,
    persistent: false,
  } as Parameters<SandboxModule['Sandbox']['create']>[0]);
  try {
    await sbx.mkDir(ROOT).catch(() => {});
    await sbx.writeFiles([
      { path: `${ROOT}/package.json`, content: Buffer.from(JSON.stringify({ name: 'robot-runner', private: true })) },
    ]);
    await check(sbx, 'npm', ['install', `playwright-core@${PLAYWRIGHT_VERSION}`, '--no-audit', '--no-fund']);
    // Librerías del sistema (apt) como root; el navegador, como el usuario normal.
    await check(sbx, 'npx', ['playwright-core', 'install-deps', 'chromium'], { sudo: true });
    await check(sbx, 'npx', ['playwright-core', 'install', 'chromium'], { env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS } });
    const snap = await sbx.snapshot({ expiration: 0 });
    return snap.snapshotId;
  } catch (err) {
    await sbx.stop().catch(() => {});
    throw err;
  }
}

async function createRunSandbox(snapshotId: string, timeoutMs: number): Promise<SandboxInstance> {
  const { Sandbox } = await loadSdk();
  const base = {
    ...credentials(),
    source: { type: 'snapshot' as const, snapshotId },
    resources: { vcpus: 2 },
    timeout: timeoutMs,
    persistent: false,
  };
  try {
    return await Sandbox.create({
      ...base,
      networkPolicy: { subnets: { allow: ['0.0.0.0/0', '::/0'], deny: PRIVATE_CIDRS } },
    } as Parameters<SandboxModule['Sandbox']['create']>[0]);
  } catch (err) {
    // Si la política de red no es aceptada, igual queda el bloqueo del arnés.
    if (!/network|policy|subnet/i.test(String(err))) throw err;
    return Sandbox.create({ ...base, networkPolicy: 'allow-all' } as Parameters<SandboxModule['Sandbox']['create']>[0]);
  }
}

export async function runInSandbox(job: RobotJob): Promise<RobotRunnerResult> {
  let snapshotId = await getStoredSnapshot();
  let sbx: SandboxInstance | null = null;
  const vmTimeout = job.timeoutMs + 90_000;
  try {
    if (snapshotId) {
      try {
        sbx = await createRunSandbox(snapshotId, vmTimeout);
      } catch (err) {
        if (process.env.ROBOTS_SANDBOX_SNAPSHOT_ID) throw err;
        // Snapshot vencido o borrado: se rearma.
        await storeSnapshot(null);
        snapshotId = null;
      }
    }
    if (!sbx) {
      snapshotId = await createRobotsSnapshot();
      await storeSnapshot(snapshotId);
      sbx = await createRunSandbox(snapshotId, vmTimeout);
    }
    const { steps, inputs, robotName } = harnessJob(job);
    const payload = {
      ...harnessJob(job),
      steps,
      inputs,
      robotName,
      timeoutMs: job.timeoutMs,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    };
    await sbx.writeFiles([
      { path: `${ROOT}/runner.cjs`, content: Buffer.from(buildRunnerScript()) },
      { path: `${ROOT}/job.json`, content: Buffer.from(JSON.stringify(payload)) },
    ]);
    const cmd = await sbx.runCommand({
      cmd: 'node',
      args: [`${ROOT}/runner.cjs`, `${ROOT}/job.json`, `${ROOT}/result.json`],
      cwd: ROOT,
      env: { PLAYWRIGHT_BROWSERS_PATH: BROWSERS },
      signal: AbortSignal.timeout(job.timeoutMs + 45_000),
    });
    const buf = await sbx.readFileToBuffer({ path: `${ROOT}/result.json` });
    if (!buf) {
      const stderr = (await cmd.stderr().catch(() => '')).slice(-300);
      return failed(`runner_crash: ${stderr || `exit ${cmd.exitCode}`}`);
    }
    return JSON.parse(buf.toString('utf8')) as RobotRunnerResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error';
    return failed(/abort|timeout/i.test(msg) ? 'timeout' : `sandbox_error: ${msg}`);
  } finally {
    if (sbx) await sbx.stop().catch(() => {});
  }
}
