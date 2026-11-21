import { afterEach, describe, expect, it } from 'vitest';
import { isE2eTestEnv } from '@/lib/e2e-env';

/**
 * Los atajos de los e2e (identidad de prueba, Próximamente abiertas) fallan
 * cerrado: E2E_DEV_SERVER solo vale en next dev, y nada vale en Vercel.
 */
const keys = ['CI', 'NODE_ENV', 'E2E_DEV_SERVER', 'VERCEL', 'VERCEL_ENV'] as const;
const env = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = Object.fromEntries(keys.map((k) => [k, env[k]]));
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

function setEnv(values: Partial<Record<(typeof keys)[number], string>>) {
  for (const k of keys) delete env[k];
  Object.assign(env, values);
}

describe('isE2eTestEnv', () => {
  it('CI y tests sí', () => {
    setEnv({ CI: '1', NODE_ENV: 'production' });
    expect(isE2eTestEnv()).toBe(true);
    setEnv({ NODE_ENV: 'test' });
    expect(isE2eTestEnv()).toBe(true);
  });

  it('el next dev de E2E_DEV=1 sí; sin la variable, no', () => {
    setEnv({ NODE_ENV: 'development', E2E_DEV_SERVER: '1' });
    expect(isE2eTestEnv()).toBe(true);
    setEnv({ NODE_ENV: 'development' });
    expect(isE2eTestEnv()).toBe(false);
  });

  it('E2E_DEV_SERVER en un build de producción no hace nada', () => {
    setEnv({ NODE_ENV: 'production', E2E_DEV_SERVER: '1' });
    expect(isE2eTestEnv()).toBe(false);
  });

  it('en Vercel nunca, aunque las variables estén puestas', () => {
    setEnv({ CI: '1', NODE_ENV: 'development', E2E_DEV_SERVER: '1', VERCEL: '1' });
    expect(isE2eTestEnv()).toBe(false);
    setEnv({ NODE_ENV: 'test', VERCEL_ENV: 'preview' });
    expect(isE2eTestEnv()).toBe(false);
  });
});
