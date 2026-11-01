/**
 * Eventos con significado propio en la ingesta ($exception, $web_vitals,
 * $ai_generation, encuestas): normalización antes de guardar y tope diario por
 * proyecto para que un sitio en un loop (o alguien con la key pública) no llene
 * la tabla.
 */
import { ensureMigrated, getClient } from '../db';
import { normalizeExceptionProps } from './errors-core';
import type { CleanEvent } from './ingest-core';

/** $exception: tipo, mensaje y cuadros limpios, huella del servidor. Lo demás pasa igual. */
export function normalizeSpecialEvents(events: CleanEvent[]): void {
  for (const e of events) if (e.event === '$exception') normalizeExceptionProps(e.properties);
}

export const DAILY_CAPS: Record<string, number> = {
  exception: Number(process.env.ANALYTICS_DAILY_EXCEPTIONS) || 100_000,
  survey: Number(process.env.ANALYTICS_DAILY_SURVEY_EVENTS) || 200_000,
  vitals: Number(process.env.ANALYTICS_DAILY_WEB_VITALS) || 500_000,
  llm: Number(process.env.ANALYTICS_DAILY_LLM) || 1_000_000,
};

export function specialClass(event: string): string | null {
  if (event === '$exception') return 'exception';
  if (event === 'survey sent' || event === 'survey shown' || event === 'survey dismissed') return 'survey';
  if (event === '$web_vitals') return 'vitals';
  if (event === '$ai_generation') return 'llm';
  return null;
}

/** Cuántos de `n` entran si el contador del día quedó en `count` después de sumarlos. */
export function allowedByCap(count: number, n: number, cap: number): number {
  return Math.max(0, Math.min(n, n - (count - cap)));
}

/** Saca los eventos especiales que pasan el tope del día. Solo cuesta una escritura si el lote trae alguno. */
export async function capSpecialEvents(projectId: string, events: CleanEvent[], now = Date.now()): Promise<CleanEvent[]> {
  const byClass = new Map<string, number>();
  for (const e of events) {
    const c = specialClass(e.event);
    if (c) byClass.set(c, (byClass.get(c) ?? 0) + 1);
  }
  if (!byClass.size || process.env.RATE_LIMIT_DISABLED === 'true') return events;
  await ensureMigrated();
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const classes = [...byClass.keys()];
  const results = await getClient().batch(
    classes.map((c) => ({
      sql: `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (key, window_start) DO UPDATE SET count = count + excluded.count RETURNING count`,
      args: [`adaily:${c}:${projectId}`, day, byClass.get(c)!, day + 86_400_000],
    })),
    'write',
  );
  const allowed = new Map<string, number>();
  classes.forEach((c, i) => allowed.set(c, allowedByCap(Number(results[i].rows[0]?.count ?? 0), byClass.get(c)!, DAILY_CAPS[c])));
  if (classes.every((c) => allowed.get(c) === byClass.get(c))) return events;
  return events.filter((e) => {
    const c = specialClass(e.event);
    if (!c) return true;
    const left = allowed.get(c) ?? 0;
    if (left <= 0) return false;
    allowed.set(c, left - 1);
    return true;
  });
}
