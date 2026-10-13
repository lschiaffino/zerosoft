/**
 * Flow — nodo "Código": JavaScript del usuario en una microVM efímera de
 * Vercel Sandbox (nunca en el proceso del servidor). Server-only.
 *
 * El código es el cuerpo de una función async que recibe `input`
 * ({ trigger, nodes }) y devuelve un valor JSON. Límites: tiempo (1-30 s),
 * memoria de V8 (128 MB), salida (256 KB) y sin red (política deny-all).
 *
 * Disponible con FLOW_CODE_RUNNER=sandbox, o por defecto en Vercel (OIDC) o
 * con VERCEL_TOKEN + VERCEL_TEAM_ID + VERCEL_PROJECT_ID. Si no, el nodo falla
 * con 'code_unavailable' y el editor lo explica.
 */

export interface CodeJob {
  code: string;
  input: unknown;
  timeoutMs: number;
}

export type CodeResult = { ok: true; result: unknown; logs: string } | { ok: false; error: string; logs?: string };

export type CodeRunner = (job: CodeJob) => Promise<CodeResult>;

export const CODE_MAX_TIMEOUT_SEC = 30;
export const CODE_MEMORY_MB = 128;
const OUTPUT_LIMIT = 256_000;
const ROOT = '/vercel/sandbox/code';
const IMAGE = 'vercel/sandbox/node:24';

let testRunner: CodeRunner | null | undefined;

/** Tests: reemplaza el runner (null = no disponible; undefined = el real). */
export function setFlowCodeRunnerForTests(runner: CodeRunner | null | undefined): void {
  testRunner = runner;
}

export function flowCodeAvailable(): boolean {
  if (testRunner !== undefined) return testRunner !== null;
  const env = (process.env.FLOW_CODE_RUNNER ?? '').trim().toLowerCase();
  if (env === 'none') return false;
  if (env === 'sandbox') return true;
  const { VERCEL, VERCEL_OIDC_TOKEN, VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  return VERCEL === '1' || !!VERCEL_OIDC_TOKEN || !!(VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID);
}

/** Script que corre dentro de la VM: carga el job, ejecuta el código y escribe el resultado. */
export function buildCodeScript(): string {
  return `'use strict';
const fs = require('fs');
const out = process.argv[3];
const logs = [];
const push = (...a) => { if (logs.join('\\n').length < 4000) logs.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); };
console.log = push; console.info = push; console.warn = push; console.error = push;
const write = (r) => { r.logs = logs.join('\\n').slice(0, 4000); fs.writeFileSync(out, JSON.stringify(r)); };
let job;
try { job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) { write({ ok: false, error: 'bad_job' }); process.exit(0); }
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let fn;
try { fn = new AsyncFunction('input', job.code); } catch (e) { write({ ok: false, error: 'syntax_error: ' + String(e && e.message || e).slice(0, 300) }); process.exit(0); }
Promise.resolve().then(() => fn(job.input)).then((v) => {
  let json;
  try { json = JSON.stringify(v === undefined ? null : v); } catch (e) { return write({ ok: false, error: 'result_not_json' }); }
  if (json.length > ${OUTPUT_LIMIT}) return write({ ok: false, error: 'result_too_large' });
  write({ ok: true, result: JSON.parse(json) });
}, (e) => write({ ok: false, error: 'code_error: ' + String(e && e.message || e).slice(0, 500) }));
`;
}

function credentials(): Record<string, string> {
  if (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL === '1') return {};
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

const sandboxRunner: CodeRunner = async (job) => {
  type SandboxModule = typeof import('@vercel/sandbox');
  const { Sandbox } = (await import('@vercel/sandbox')) as SandboxModule;
  type Params = Parameters<SandboxModule['Sandbox']['create']>[0];
  const base = { ...credentials(), image: IMAGE, resources: { vcpus: 1 }, timeout: job.timeoutMs + 60_000, persistent: false };
  let sbx: Awaited<ReturnType<SandboxModule['Sandbox']['create']>> | null = null;
  try {
    try {
      sbx = await Sandbox.create({ ...base, networkPolicy: 'deny-all' } as unknown as Params);
    } catch (err) {
      if (!/network|policy/i.test(String(err))) throw err;
      sbx = await Sandbox.create(base as unknown as Params);
    }
    await sbx.mkDir(ROOT).catch(() => {});
    await sbx.writeFiles([
      { path: `${ROOT}/runner.cjs`, content: Buffer.from(buildCodeScript()) },
      { path: `${ROOT}/job.json`, content: Buffer.from(JSON.stringify({ code: job.code, input: job.input })) },
    ]);
    await sbx.runCommand({
      cmd: 'node',
      args: [`--max-old-space-size=${CODE_MEMORY_MB}`, `${ROOT}/runner.cjs`, `${ROOT}/job.json`, `${ROOT}/result.json`],
      cwd: ROOT,
      signal: AbortSignal.timeout(job.timeoutMs),
    });
    const buf = await sbx.readFileToBuffer({ path: `${ROOT}/result.json` });
    if (!buf) return { ok: false, error: 'code_crashed' };
    return JSON.parse(buf.toString('utf8')) as CodeResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error';
    return { ok: false, error: /abort|timeout/i.test(msg) ? 'code_timeout' : `sandbox_error: ${msg}` };
  } finally {
    if (sbx) await sbx.stop().catch(() => {});
  }
};

export async function runFlowCode(job: CodeJob): Promise<CodeResult> {
  if (!flowCodeAvailable()) return { ok: false, error: 'code_unavailable' };
  const runner = testRunner ?? sandboxRunner;
  return runner({ ...job, timeoutMs: Math.min(Math.max(job.timeoutMs, 1000), CODE_MAX_TIMEOUT_SEC * 1000) });
}
