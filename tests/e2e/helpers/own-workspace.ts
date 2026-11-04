import { expect, test } from '@playwright/test';

/**
 * Un workspace propio para un archivo de tests: lo que tiene tope por workspace
 * (corridas de robots por hora, cuotas) no se comparte con el resto de la suite,
 * así el resultado no depende de qué otros archivos caen en el mismo shard.
 * Usa la cookie de identidad de e2e (lib/session.ts, solo con E2E_IDENTITY_COOKIE).
 */
export function ownWorkspace(tag: string): string {
  const email = `${tag}-${Math.random().toString(36).slice(2, 10)}@own-e2e.test`;
  const port = Number(process.env.E2E_PORT) || 3210;
  const cookie = { name: 'zs_e2e_as', value: email, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const };
  test.use({ storageState: { cookies: [cookie], origins: [] } });
  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: `http://localhost:${port}`, storageState: { cookies: [cookie], origins: [] } });
    try {
      const res = await ctx.post('/api/onboarding', { data: { kind: 'full', mode: 'personal', name: tag, locale: 'en' } });
      expect(res.ok(), await res.text()).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
  return email;
}
