/**
 * La tarjeta "App de escritorio" del inicio de la app: se ofrece a quien no
 * la instaló (desktop_installed, de lib/lifecycle/signals.ts) y no la cerró
 * (desktop_hint_dismissed). Las dos marcas van en lifecycle_events, así el
 * cierre vale en todos sus dispositivos. Server-only.
 */
import { getDb } from './db';
import { recordLifecycleEvent } from './lifecycle/signals';

export async function desktopHintState(userId: string): Promise<{ installed: boolean; dismissed: boolean }> {
  try {
    const rows = (await getDb()
      .prepare("SELECT event FROM lifecycle_events WHERE user_id = ? AND event IN ('desktop_installed', 'desktop_hint_dismissed')")
      .all(userId)) as Array<{ event: string }>;
    const set = new Set(rows.map((r) => r.event));
    return { installed: set.has('desktop_installed'), dismissed: set.has('desktop_hint_dismissed') };
  } catch {
    // Sin la tabla (self-host sin migrar): no se ofrece, mejor que ofrecerlo sin poder cerrarlo.
    return { installed: false, dismissed: true };
  }
}

/** Mostrar la tarjeta (el cliente además la esconde en el teléfono, Linux y dentro de la app). */
export function showDesktopHint(state: { installed: boolean; dismissed: boolean }): boolean {
  return !state.installed && !state.dismissed;
}

export async function dismissDesktopHint(userId: string): Promise<void> {
  await recordLifecycleEvent(userId, 'desktop_hint_dismissed');
}
