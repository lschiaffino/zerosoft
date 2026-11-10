// Child process helpers. Always spawn with argument arrays (no shell).
import { spawn, execFile } from 'node:child_process';

const PASS_THROUGH = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_RUNTIME_DIR', 'PULSE_SERVER', 'FONTCONFIG_PATH'];

/**
 * Minimal environment for child processes (Chromium, ffmpeg, Xvfb, pactl):
 * an allowlist of harmless variables plus `extra`. Secrets never pass.
 * @param {Record<string, string|undefined>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(extra = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const k of PASS_THROUGH) if (process.env[k]) env[k] = process.env[k];
  if (!env.PATH) env.PATH = '/usr/local/bin:/usr/bin:/bin';
  for (const [k, v] of Object.entries(extra)) if (v) env[k] = v;
  return env;
}

/**
 * Runs a command, resolves { code, stdout, stderr }. Never rejects on non-zero.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 60000, maxBuffer: 8 * 1024 * 1024, env: opts.env ?? childEnv() },
      (err, stdout, stderr) => {
        const code = err ? (typeof (/** @type {any} */ (err).code) === 'number' ? /** @type {any} */ (err).code : -1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * @param {import('node:child_process').ChildProcess} proc
 * @param {number} ms
 * @returns {Promise<boolean>} true if it exited within ms
 */
export function waitExit(proc, ms) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      proc.off('exit', onExit);
      resolve(false);
    }, ms);
    function onExit() {
      clearTimeout(t);
      resolve(true);
    }
    proc.once('exit', onExit);
  });
}

/**
 * Sends `signal`, waits graceMs, then SIGKILL.
 * @param {import('node:child_process').ChildProcess|null|undefined} proc
 * @param {NodeJS.Signals} [signal]
 * @param {number} [graceMs]
 */
export async function stopProc(proc, signal = 'SIGTERM', graceMs = 5000) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    proc.kill(signal);
  } catch {
    return;
  }
  if (await waitExit(proc, graceMs)) return;
  try {
    proc.kill('SIGKILL');
  } catch {}
  await waitExit(proc, 2000);
}

/**
 * Spawns a long-running process and keeps the last bytes of stderr for diagnostics.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function spawnTracked(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], env: opts.env ?? childEnv() });
  let tail = '';
  proc.stderr?.on('data', (d) => {
    tail = (tail + d.toString()).slice(-2000);
  });
  proc.on('error', () => {});
  return { proc, stderrTail: () => tail };
}

export { spawn };
