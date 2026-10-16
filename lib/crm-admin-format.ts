/** Formatos chicos de las vistas de administración del CRM (puros, testeables). */

/** Resultado de una corrida de workflow: cuántas acciones salieron bien sobre el total. */
export function runSummary(output: string | null): { ok: number; total: number } | null {
  try {
    const parsed = JSON.parse(output || '{}') as { results?: Array<{ ok: boolean }> };
    if (!Array.isArray(parsed.results)) return null;
    return { ok: parsed.results.filter((r) => r.ok).length, total: parsed.results.length };
  } catch {
    return null;
  }
}

/** "Lautaro · zerosoft" a partir de nombre y empresa (o el email si no hay nombre). */
export function partySummary(name?: string, company?: string, email?: string): string {
  return [name?.trim() || email?.trim(), company?.trim()].filter(Boolean).join(' · ');
}
