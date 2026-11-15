import { describe, expect, it } from 'vitest';
import { checkRouteGuards, guardsUsed, publicRoutes } from '../../scripts/api-route-guards.mjs';

/**
 * Toda ruta de la API pasa por un chequeo de sesión o de API key, o está en
 * scripts/api-public-routes.json con el motivo (webhook firmado, cron con
 * secreto, link con token, página pública). Una ruta nueva sin guard hace
 * fallar este test: o usa un guard o se agrega a la lista a conciencia.
 */
describe('rutas de la API: guard de sesión o lista pública explícita', () => {
  const result = checkRouteGuards() as { files: string[]; unguarded: string[]; missing: string[]; stale: string[] };

  it('encuentra las rutas', () => {
    expect(result.files.length).toBeGreaterThan(1000);
  });

  it('no hay rutas sin guard fuera de la lista pública', () => {
    expect(result.missing).toEqual([]);
  });

  it('la lista pública no tiene rutas que ya no existen o que ya tienen guard', () => {
    expect(result.stale).toEqual([]);
  });

  it('cada ruta pública dice por qué', () => {
    for (const [file, reason] of Object.entries(publicRoutes() as Record<string, string>)) {
      expect(reason.trim().length, file).toBeGreaterThan(5);
    }
  });

  it('las rutas de la app que leen datos personales tienen guard', () => {
    for (const f of ['app/api/search/route.ts', 'app/api/notes/route.ts', 'app/api/inbox/state/route.ts', 'app/api/notifications/route.ts', 'lib/routes/agents/[id]/conversations/route.ts']) {
      expect((guardsUsed(f) as string[]).length, f).toBeGreaterThan(0);
    }
  });
});
