/**
 * Robots — backends de ejecución. Server-only.
 *
 *  - sandbox: Vercel Sandbox (microVM Firecracker efímera). Lo que usa la nube.
 *    Auth por OIDC en Vercel, o VERCEL_TOKEN + VERCEL_TEAM_ID +
 *    VERCEL_PROJECT_ID fuera de Vercel. Ver lib/robots-sandbox.ts.
 *  - local: playwright-core en el mismo proceso con un Chromium instalado en
 *    el servidor (self-host). ROBOTS_RUNNER=local.
 *  - none: no se pueden correr robots en este servidor (la UI lo explica).
 *
 * Elección: ROBOTS_RUNNER=sandbox|local|none. Sin variable: sandbox en Vercel
 * (VERCEL=1), none en el resto.
 */
import { assertPublicUrl, UnsafeUrlError } from './safe-fetch';
import {
  robotHarness,
  robotInterpreter,
  type HarnessChromium,
  type HarnessJob,
  type InterpreterResult,
  type InterpreterStep,
} from './robots-interpreter';
import { MAX_EXECUTED_STEPS, MAX_LOOP_ITEMS, MAX_PAGES, MAX_SCREENSHOTS } from './robots-schema';

export type RobotBackendName = 'sandbox' | 'local' | 'none';

export interface RobotJob {
  robotName: string;
  steps: InterpreterStep[];
  inputs: Record<string, unknown>;
  timeoutMs: number;
}

export type RobotRunnerResult = InterpreterResult;

export interface RobotBackend {
  name: Exclude<RobotBackendName, 'none'>;
  run(job: RobotJob): Promise<RobotRunnerResult>;
}

let testBackend: RobotBackend | null | undefined;

/** Tests: reemplaza el backend (null = ninguno; undefined = el real). */
export function setRobotBackendForTests(backend: RobotBackend | null | undefined): void {
  testBackend = backend;
}

export function robotBackendName(): RobotBackendName {
  if (testBackend !== undefined) return testBackend ? testBackend.name : 'none';
  const env = (process.env.ROBOTS_RUNNER ?? '').trim().toLowerCase();
  if (env === 'sandbox' || env === 'local' || env === 'none') return env;
  return process.env.VERCEL === '1' ? 'sandbox' : 'none';
}

export function getRobotBackend(): RobotBackend | null {
  if (testBackend !== undefined) return testBackend;
  const name = robotBackendName();
  if (name === 'local') return localBackend;
  if (name === 'sandbox') return sandboxBackend;
  return null;
}

/** SSRF: misma regla que safeFetch (solo http(s) a hosts públicos). */
export async function checkRobotUrl(url: string): Promise<string | null> {
  try {
    await assertPublicUrl(url, { allowHttp: true });
    return null;
  } catch (err) {
    return err instanceof UnsafeUrlError ? err.message : 'invalid_url';
  }
}

export function harnessJob(job: RobotJob, extra: Partial<HarnessJob> = {}): HarnessJob {
  return {
    steps: job.steps,
    inputs: job.inputs,
    robotName: job.robotName,
    deadline: Date.now() + job.timeoutMs,
    maxPages: MAX_PAGES,
    maxScreenshots: MAX_SCREENSHOTS,
    maxExecuted: MAX_EXECUTED_STEPS,
    maxLoopItems: MAX_LOOP_ITEMS,
    ...extra,
  };
}

// ---------- local ----------

const localBackend: RobotBackend = {
  name: 'local',
  async run(job) {
    let chromium: HarnessChromium;
    try {
      // Import dinámico: playwright-core solo se carga si se usa el runner local.
      const mod = (await import('playwright-core')) as unknown as {
        chromium?: HarnessChromium;
        default?: { chromium: HarnessChromium };
      };
      chromium = (mod.chromium ?? mod.default?.chromium) as HarnessChromium;
      if (!chromium) throw new Error('missing chromium');
    } catch {
      return failed('runner_unavailable: playwright-core is not installed');
    }
    return robotHarness(
      chromium,
      harnessJob(job, { executablePath: process.env.ROBOTS_CHROMIUM_PATH || undefined }),
      robotInterpreter,
      checkRobotUrl,
    );
  },
};

// ---------- sandbox ----------

const sandboxBackend: RobotBackend = {
  name: 'sandbox',
  async run(job) {
    const { runInSandbox } = await import('./robots-sandbox');
    return runInSandbox(job);
  },
};

export function failed(error: string): RobotRunnerResult {
  return { status: 'failed', error, vars: {}, logs: [], screenshots: [], pages: 0 };
}
