import { afterEach, describe, expect, it } from 'vitest';
import { isStaff } from '@/lib/workspace-apps';

/**
 * E2E_COMING_SOON_OPEN abre las apps "Próximamente" a las cuentas de prueba en
 * los e2e. Tiene que fallar cerrado: sin la variable, en Vercel o para las
 * cuentas @soon-e2e.io (que prueban el corte), nadie es staff por esta vía.
 */
const keys = ['E2E_COMING_SOON_OPEN', 'VERCEL', 'VERCEL_ENV', 'CI', 'ADMIN_EMAILS'] as const;
const saved: Record<string, string | undefined> = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string | undefined>)[k] = saved[k];
  }
});

describe('staff de los e2e (solo CI y tests)', () => {
  it('sin la variable nadie es staff por esta vía', () => {
    delete process.env.E2E_COMING_SOON_OPEN;
    delete process.env.ADMIN_EMAILS;
    expect(isStaff('ana@example.com')).toBe(false);
  });

  it('con la variable, las cuentas de prueba abren las Próximamente, menos las @soon-e2e.io', () => {
    process.env.E2E_COMING_SOON_OPEN = '1';
    delete process.env.ADMIN_EMAILS;
    expect(isStaff('ana@example.com')).toBe(true);
    expect(isStaff('Sole-abc@soon-e2e.io')).toBe(false);
  });

  it('en Vercel no hace nada, aunque la variable esté puesta', () => {
    process.env.E2E_COMING_SOON_OPEN = '1';
    delete process.env.ADMIN_EMAILS;
    process.env.VERCEL = '1';
    expect(isStaff('ana@example.com')).toBe(false);
    delete process.env.VERCEL;
    process.env.VERCEL_ENV = 'production';
    expect(isStaff('ana@example.com')).toBe(false);
  });
});
