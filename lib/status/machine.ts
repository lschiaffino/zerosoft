import type { ComponentStatus } from './components';

/**
 * Máquina de estados de un componente, pura (sin DB ni reloj): la usan el cron
 * y los reportes del watcher, y la prueban los tests unitarios.
 *
 * - Un incidente se abre con OPEN_AFTER fallas seguidas (un chequeo que falla
 *   una vez y pasa el siguiente no abre nada: evita el flapping).
 * - Se resuelve con RESOLVE_AFTER pasadas seguidas; una falla en el medio
 *   reinicia la cuenta.
 * - "Falla" es todo lo que no es up: degraded, down y unknown (el watcher dejó
 *   de reportar).
 * - Con el incidente abierto, si empeora (degraded → down, o pasa de unknown a
 *   un estado medido) se anota en la línea de tiempo.
 */

export const OPEN_AFTER = 2;
export const RESOLVE_AFTER = 3;

export interface MachineState {
  failStreak: number;
  okStreak: number;
  /** Severidad del incidente abierto, o null si no hay. */
  incident: Exclude<ComponentStatus, 'up'> | null;
}

export type MachineEvent =
  | { type: 'open'; severity: Exclude<ComponentStatus, 'up'> }
  | { type: 'fail' }
  | { type: 'change'; from: Exclude<ComponentStatus, 'up'>; to: Exclude<ComponentStatus, 'up'> }
  | { type: 'resolve' };

const RANK: Record<Exclude<ComponentStatus, 'up'>, number> = { unknown: 0, degraded: 1, down: 2 };

export const INITIAL_STATE: MachineState = { failStreak: 0, okStreak: 0, incident: null };

export function step(prev: MachineState, result: ComponentStatus): { next: MachineState; events: MachineEvent[] } {
  const bad = result !== 'up';
  const failStreak = bad ? prev.failStreak + 1 : 0;
  const okStreak = bad ? 0 : prev.okStreak + 1;
  const events: MachineEvent[] = [];
  let incident = prev.incident;

  if (bad) {
    const sev = result as Exclude<ComponentStatus, 'up'>;
    if (!incident) {
      if (failStreak >= OPEN_AFTER) {
        incident = sev;
        events.push({ type: 'open', severity: sev });
      }
    } else {
      events.push({ type: 'fail' });
      // Empeoró, o se supo qué pasa después de no saber nada (unknown → medido).
      if (RANK[sev] > RANK[incident]) {
        events.push({ type: 'change', from: incident, to: sev });
        incident = sev;
      }
    }
  } else if (incident && okStreak >= RESOLVE_AFTER) {
    incident = null;
    events.push({ type: 'resolve' });
  }

  return { next: { failStreak, okStreak, incident }, events };
}

/**
 * Estado a mostrar de un componente: el del incidente abierto, o up. Una falla
 * suelta (todavía sin incidente) no se muestra: así la página no parpadea.
 */
export function shownStatus(state: MachineState): ComponentStatus {
  return state.incident ?? 'up';
}

/** Código compacto por minuto en la base. */
export const STATUS_CODE: Record<ComponentStatus, number> = { up: 0, degraded: 1, down: 2, unknown: 3 };

/** El peor de varios estados (unknown solo si no hay nada medido). */
export function worstStatus(list: ComponentStatus[]): ComponentStatus {
  const known = list.filter((s) => s !== 'unknown');
  if (known.length === 0) return list.length ? 'unknown' : 'up';
  if (known.includes('down')) return 'down';
  if (known.includes('degraded')) return 'degraded';
  return 'up';
}
