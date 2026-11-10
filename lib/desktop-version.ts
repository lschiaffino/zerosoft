/**
 * Versiones de la app de escritorio (X.Y.Z). El updater de Tauri funciona
 * desde la 0.3.1 (firma estable en Mac): las anteriores hay que bajarlas a
 * mano, y con su firma ad hoc macOS ata Accesibilidad a cada build.
 */
export const FIRST_SELF_UPDATING = '0.3.1';

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1, 0 o 1; una versión que no se entiende cuenta como la más vieja. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export type DesktopUpdateKind = 'none' | 'auto' | 'manual';

/** Qué decir: nada (al día), "se actualiza sola" o "bajala a mano" (antes de la 0.3.1). */
export function desktopUpdateKind(current: string, latest: string): DesktopUpdateKind {
  if (!parseVersion(latest) || compareVersions(current, latest) >= 0) return 'none';
  return compareVersions(current, FIRST_SELF_UPDATING) < 0 ? 'manual' : 'auto';
}
