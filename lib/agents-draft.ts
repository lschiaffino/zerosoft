/**
 * Agents — borrador y versión publicada (sin acceso a la base).
 *
 * La fila de `agents` es siempre la configuración EN VIVO: la usan Chat, la
 * página pública, la API, Flow, Groups y las aprobaciones, sin cambios. Con
 * versiones activas (published_version_id no nulo), lo que se guarda desde el
 * editor queda en `agents.draft` hasta publicarlo (lib/agents-versions.ts);
 * el playground y los tests corren sobre el borrador. Nombre, emoji, pausa y
 * handle público no pasan por el borrador: se aplican al guardar.
 */
import type { AgentRow } from './db';
import {
  parseGuardrails,
  parseHandoff,
  parseKnowledge,
  parseSettings,
  parseTools,
  type AgentDto,
} from './agents-config';

export const DRAFTED_KEYS = [
  'instructions',
  'welcomeMessage',
  'model',
  'temperature',
  'knowledge',
  'tools',
  'handoff',
  'guardrails',
  'settings',
] as const;
export type DraftedKey = (typeof DRAFTED_KEYS)[number];
export type AgentSnapshot = Pick<AgentDto, DraftedKey>;

/** Configuración en vivo de la fila. */
export function snapshotOfRow(row: AgentRow): AgentSnapshot {
  return {
    instructions: row.instructions,
    welcomeMessage: row.welcome_message,
    model: row.model,
    temperature: Number(row.temperature),
    knowledge: parseKnowledge(row.knowledge),
    tools: parseTools(row.tools),
    handoff: parseHandoff(row.handoff),
    guardrails: parseGuardrails(row.guardrails),
    settings: parseSettings(row.settings),
  };
}

/** Normaliza un snapshot guardado (JSON de una versión o del borrador). */
export function parseSnapshot(raw: string | null | undefined): AgentSnapshot | null {
  if (!raw) return null;
  let v: Partial<Record<DraftedKey, unknown>>;
  try {
    v = JSON.parse(raw) as Partial<Record<DraftedKey, unknown>>;
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  return {
    instructions: typeof v.instructions === 'string' ? v.instructions : '',
    welcomeMessage: typeof v.welcomeMessage === 'string' ? v.welcomeMessage : '',
    model: typeof v.model === 'string' && v.model ? v.model : null,
    temperature: typeof v.temperature === 'number' ? v.temperature : 0.3,
    knowledge: parseKnowledge(JSON.stringify(v.knowledge ?? {})),
    tools: parseTools(JSON.stringify(v.tools ?? {})),
    handoff: parseHandoff(JSON.stringify(v.handoff ?? {})),
    guardrails: parseGuardrails(JSON.stringify(v.guardrails ?? {})),
    settings: parseSettings(JSON.stringify(v.settings ?? {})),
  };
}

export function versioningOn(row: Pick<AgentRow, 'published_version_id'>): boolean {
  return Boolean(row.published_version_id);
}

/** Lo que ve el editor: el borrador si hay, si no lo publicado. */
export function draftOf(row: AgentRow): AgentSnapshot {
  return (versioningOn(row) ? parseSnapshot(row.draft) : null) ?? snapshotOfRow(row);
}

export function hasDraft(row: AgentRow): boolean {
  return versioningOn(row) && parseSnapshot(row.draft) !== null;
}

/** Columnas de `agents` para un snapshot. */
export function snapshotColumns(s: AgentSnapshot): Array<[string, string | number | null]> {
  return [
    ['instructions', s.instructions],
    ['welcome_message', s.welcomeMessage],
    ['model', s.model || null],
    ['temperature', s.temperature],
    ['knowledge', JSON.stringify(s.knowledge)],
    ['tools', JSON.stringify(s.tools)],
    ['handoff', JSON.stringify(s.handoff)],
    ['guardrails', JSON.stringify(s.guardrails)],
    ['settings', JSON.stringify(s.settings)],
  ];
}

/** Copia de la fila con el snapshot aplicado (para correr el borrador). */
export function applySnapshot(row: AgentRow, s: AgentSnapshot): AgentRow {
  const next = { ...row } as AgentRow & Record<string, unknown>;
  for (const [col, value] of snapshotColumns(s)) next[col] = value;
  return next;
}

/** La fila con el borrador aplicado (playground, tests, editor). */
export function withDraft(row: AgentRow): AgentRow {
  return hasDraft(row) ? applySnapshot(row, draftOf(row)) : row;
}

/** Claves que difieren entre dos snapshots. */
export function changedKeys(a: AgentSnapshot, b: AgentSnapshot): DraftedKey[] {
  return DRAFTED_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
