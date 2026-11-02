/** Ver components/app/RouterNudge.tsx. */
export const NUDGE_EVERY_MS = 500;
/** Cuánto dura después de cargar o de una acción de la persona: lo que puede tardar una navegación. */
export const NUDGE_WINDOW_MS = 20_000;

export function nudgeActive(now: number, lastActivity: number): boolean {
  return now - lastActivity < NUDGE_WINDOW_MS;
}
