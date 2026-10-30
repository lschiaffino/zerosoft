/**
 * Sign: qué pasa en otras apps cuando un sobre se completa o se rechaza
 * (adjunto en el CRM, oferta de Hiring). Import diferido: la firma pública no
 * carga el CRM ni Hiring hasta que hace falta.
 */
import type { EnvelopeRow } from './core';

export async function runSignHooks(kind: 'completed' | 'declined', env: EnvelopeRow, who: { name: string; email: string; reason?: string } | null): Promise<void> {
  if (!env.links || env.links === '[]') return;
  const { runIntegrations } = await import('./integrations');
  await runIntegrations(kind, env, who);
}
