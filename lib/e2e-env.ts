/**
 * ¿Corre bajo los e2e de Playwright (o los tests)? Lo usan los atajos que solo
 * existen para las pruebas: la identidad de prueba (cookie zs_e2e_as, lib/session.ts)
 * y las apps "Próximamente" abiertas (lib/workspace-apps.ts). Falla cerrado:
 *
 * - CI (next start del build de producción) o NODE_ENV=test (vitest).
 * - Local con `E2E_DEV=1 npx playwright test`: playwright.config.ts levanta
 *   `next dev` con E2E_DEV_SERVER=1. Solo vale con NODE_ENV=development, así que
 *   en un build de producción (`next start`, Vercel) esa variable no hace nada.
 * - Nunca en Vercel, aunque alguna de las variables estuviera puesta.
 */
export function isE2eTestEnv(): boolean {
  if (process.env.VERCEL_ENV || process.env.VERCEL) return false;
  if (Boolean(process.env.CI) || process.env.NODE_ENV === 'test') return true;
  return process.env.E2E_DEV_SERVER === '1' && process.env.NODE_ENV === 'development';
}
